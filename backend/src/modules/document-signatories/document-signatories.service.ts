import * as crypto from 'crypto';
import { emailButton } from '../email/email-layout';
import {
  BadRequestException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { DocumentSignatoriesRepository } from './document-signatories.repository';
import { DocumentSignatory } from './entities/document-signatory.entity';
import { CreateSignatoryDto } from './dto/create-signatory.dto';
import { UpdateSignatoryDto } from './dto/update-signatory.dto';
import { EmailService } from '../email/email.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { CommercialDocument } from '../documents/entities/commercial-document.entity';
import { Subject } from 'rxjs';

const TOKEN_TTL_DAYS = 7;

@Injectable()
export class DocumentSignatoriesService {
  /**
   * Avisa cada firma confirmada. Lo escucha el acta de conformidad de un
   * requerimiento, que se cierra cuando firman todos. Se emite con la firma ya
   * guardada: un fallo de quien escucha no afecta a la firma.
   */
  readonly signed$ = new Subject<{ documentId: number }>();

  constructor(
    private readonly repo: DocumentSignatoriesRepository,
    private readonly email: EmailService,
    private readonly workspace: WorkspaceService,
    private readonly config: ConfigService,
    @InjectRepository(CommercialDocument)
    private readonly docOrm: Repository<CommercialDocument>,
  ) {}

  list(documentId: number): Promise<DocumentSignatory[]> {
    return this.repo.listByDocument(documentId);
  }

  async findOrFail(id: number): Promise<DocumentSignatory> {
    const s = await this.repo.findById(id);
    if (!s) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Firmante no encontrado' });
    return s;
  }

  create(documentId: number, dto: CreateSignatoryDto): Promise<DocumentSignatory> {
    return this.repo.create({
      documentId,
      userId: dto.userId ?? null,
      kind: dto.kind,
      fullName: dto.fullName.trim(),
      documentNumber: dto.documentNumber?.trim() || null,
      email: dto.email?.trim() || null,
      role: dto.role?.trim() || null,
      conformityStatus: 'PENDING',
      notes: null,
    });
  }

  async update(id: number, dto: UpdateSignatoryDto): Promise<DocumentSignatory> {
    await this.findOrFail(id);
    const patch: Partial<DocumentSignatory> = {};
    if (dto.conformityStatus !== undefined) patch.conformityStatus = dto.conformityStatus;
    if (dto.notes !== undefined) patch.notes = dto.notes?.trim() || null;
    if (dto.role !== undefined) patch.role = dto.role?.trim() || null;
    return (await this.repo.update(id, patch))!;
  }

  async remove(id: number): Promise<void> {
    await this.findOrFail(id);
    await this.repo.remove(id);
  }

  // -------------------------------------------------------------------------
  // Firma electrónica — solicitar
  // -------------------------------------------------------------------------

  async requestSignature(id: number): Promise<DocumentSignatory> {
    const sig = await this.findOrFail(id);

    if (!sig.email) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: 'El firmante no tiene email registrado.',
      });
    }
    if (sig.conformityStatus === 'SIGNED') {
      throw new BadRequestException({
        code: 'CONFLICT',
        message: 'Este firmante ya confirmó su firma.',
      });
    }

    const doc = await this.docOrm.findOne({ where: { id: sig.documentId } });
    if (!doc) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Documento no encontrado' });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + TOKEN_TTL_DAYS);

    await this.repo.update(id, { signatureToken: token, tokenExpiresAt: expiresAt });

    // `|| ''` y no `??`: `docker-compose.yml` inyecta `FRONTEND_URL: ${FRONTEND_URL}`
    // y Compose **sustituye por cadena vacía** cuando la variable no está en el
    // `.env` — no omite la clave. Con `??`, una cadena vacía pasaría de largo y el
    // enlace saldría como `/sign/<token>`, sin host: irreparable para quien lo
    // recibe. Con `||`, cae al valor por defecto, que al menos se puede corregir a
    // mano.
    const frontendUrl =
      (this.config.get<string>('FRONTEND_URL') || '').trim() || 'http://localhost:5173';
    const signUrl = `${frontendUrl}/sign/${token}`;
    const emisor = await this.workspace.get().catch(() => null);
    const brand = emisor?.razonSocial ?? 'Kubo Platform';

    await this.email.send({
      to: sig.email,
      subject: `Solicitud de firma: ${doc.title}`,
      html: this.buildSignatureEmail({ signerName: sig.fullName, docTitle: doc.title, signUrl, brand, expiresAt }),
    });

    return (await this.repo.findById(id))!;
  }

  // -------------------------------------------------------------------------
  // Firma electrónica — consultar por token (página pública)
  // -------------------------------------------------------------------------

  async getByToken(token: string): Promise<{
    signatoryName: string;
    signatoryEmail: string;
    documentTitle: string;
    documentMarkdown: string;
    alreadySigned: boolean;
    signedAt: Date | null;
    expired: boolean;
  }> {
    const sig = await this.repo.findByToken(token);
    if (!sig) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Link de firma no encontrado o inválido.' });

    const doc = await this.docOrm.findOne({ where: { id: sig.documentId } });
    if (!doc) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Documento no encontrado.' });

    const expired = sig.tokenExpiresAt ? new Date() > sig.tokenExpiresAt : false;

    return {
      signatoryName: sig.fullName,
      signatoryEmail: sig.email ?? '',
      documentTitle: doc.title,
      documentMarkdown: doc.contentMarkdown,
      alreadySigned: sig.conformityStatus === 'SIGNED',
      signedAt: sig.signedAt,
      expired,
    };
  }

  // -------------------------------------------------------------------------
  // Firma electrónica — confirmar
  // -------------------------------------------------------------------------

  async confirmSignature(token: string, ip: string): Promise<{ message: string; signedAt: Date }> {
    const sig = await this.repo.findByToken(token);
    if (!sig) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Link de firma no encontrado o inválido.' });

    if (sig.conformityStatus === 'SIGNED') {
      throw new BadRequestException({ code: 'CONFLICT', message: 'Esta firma ya fue registrada anteriormente.' });
    }
    if (sig.tokenExpiresAt && new Date() > sig.tokenExpiresAt) {
      throw new GoneException({ code: 'EXPIRED', message: 'El link de firma ha expirado. Solicita uno nuevo.' });
    }

    const now = new Date();
    await this.repo.update(sig.id, {
      conformityStatus: 'SIGNED',
      signedAt: now,
      signedIp: ip,
    });
    this.signed$.next({ documentId: Number(sig.documentId) });

    return { message: 'Firma registrada correctamente.', signedAt: now };
  }

  // -------------------------------------------------------------------------
  // Email HTML
  // -------------------------------------------------------------------------

  private buildSignatureEmail(args: {
    signerName: string;
    docTitle: string;
    signUrl: string;
    brand: string;
    expiresAt: Date;
  }): string {
    const { signerName, docTitle, signUrl, brand, expiresAt } = args;
    const exp = expiresAt.toLocaleDateString('es-PE', { dateStyle: 'long' });
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Solo el contenido: el marco Kubo (logo y pie) lo pone EmailService (spec 2026-11-28).
    return `<p style="margin:0 0 4px;font-size:12px;color:#5b6b78;text-transform:uppercase;letter-spacing:.06em;font-weight:700">Solicitud de firma electrónica</p>
<h1 style="margin:0 0 16px;font-size:21px;line-height:1.3;color:#012660">${esc(docTitle)}</h1>
<p style="margin:0 0 12px">Estimado/a <strong>${esc(signerName)}</strong>,</p>
<p style="margin:0 0 6px"><strong>${esc(brand)}</strong> te solicita revisar y confirmar tu conformidad con el documento indicado. El enlace estará disponible hasta el <strong>${esc(exp)}</strong>.</p>
${emailButton(signUrl, 'Revisar y firmar documento')}
<p style="margin:0;font-size:12px;line-height:1.5;color:#7a8794">Si el botón no funciona, copia este enlace en tu navegador:<br/><span style="color:#053777;word-break:break-all">${esc(signUrl)}</span></p>
<p style="margin:16px 0 0;font-size:12px;color:#7a8794">Si crees que recibiste este correo por error, ignóralo.</p>`;
  }
}
