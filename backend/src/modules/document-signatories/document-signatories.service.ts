import * as crypto from 'crypto';
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

const TOKEN_TTL_DAYS = 7;

@Injectable()
export class DocumentSignatoriesService {
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

    const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
    const signUrl = `${frontendUrl}/sign/${token}`;
    const emisor = await this.workspace.get().catch(() => null);
    const brand = emisor?.razonSocial ?? 'Kubo DevDocs';

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

    return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0F172A">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(15,23,42,.08)">
        <tr>
          <td style="background:linear-gradient(135deg,#4F46E5 0%,#6366F1 100%);padding:24px 28px">
            <span style="font-size:18px;font-weight:700;color:#ffffff">${esc(brand)}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:28px">
            <p style="margin:0 0 6px;font-size:12px;color:#64748B;text-transform:uppercase;letter-spacing:.06em;font-weight:600">Solicitud de firma electrónica</p>
            <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#0F172A">${esc(docTitle)}</h1>
            <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155">
              Estimado/a <strong>${esc(signerName)}</strong>,
            </p>
            <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#334155">
              Se te solicita revisar y confirmar tu conformidad con el documento indicado. El link estará disponible hasta el <strong>${esc(exp)}</strong>.
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 20px">
              <tr>
                <td style="border-radius:8px;background:#4F46E5">
                  <a href="${signUrl}" target="_blank" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">
                    Revisar y firmar documento →
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:0;font-size:12px;color:#94A3B8;text-align:center">
              Si no puedes hacer clic en el botón, copia este link en tu navegador:<br/>
              <span style="color:#6366F1">${signUrl}</span>
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 28px;background:#F8FAFC;border-top:1px solid #E2E8F0">
            <p style="margin:0;font-size:11px;color:#94A3B8">
              Este correo fue enviado automáticamente desde <strong>${esc(brand)}</strong>. Si crees que lo recibiste por error, ignóralo.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }
}
