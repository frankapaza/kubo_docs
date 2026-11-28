import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuthUser } from '../../../common/decorators/current-user.decorator';
import { ActaAnnex } from '../entities/acta-annex.entity';
import { Acta } from '../entities/acta.entity';

/** Una foto de iPad comprimida en el navegador queda muy por debajo; más es un error. */
export const MAX_ANNEX_IMAGE_BYTES = 5 * 1024 * 1024;

const MAGIC: Record<string, string> = { 'image/jpeg': 'ffd8ff', 'image/png': '89504e470d0a1a0a' };

export interface AnnexFields {
  caption?: string;
  section?: string;
  place?: 'ANEXO' | 'INLINE';
}

export type AnnexView = Omit<ActaAnnex, 'image'> & { hasImage: boolean };

const view = (a: ActaAnnex): AnnexView => {
  const { image: _img, ...rest } = a;
  return { ...rest, hasImage: !!a.imageMime };
};

/**
 * Evidencias del acta (spec 2026-11-28-metodologia-ia-hoja-de-ruta): varias, cada una
 * foto y/o texto; van como «Anexos» al final del PDF, o en su sección, solo si hay.
 */
@Injectable()
export class ActaAnnexesService {
  constructor(
    @InjectRepository(ActaAnnex) private readonly repo: Repository<ActaAnnex>,
    @InjectRepository(Acta) private readonly actas: Repository<Acta>,
  ) {}

  async list(actaId: number): Promise<AnnexView[]> {
    return (await this.repo.find({ where: { actaId }, order: { position: 'ASC', id: 'ASC' } })).map(view);
  }

  /** Con la imagen, para el PDF. */
  withImages(actaId: number): Promise<ActaAnnex[]> {
    return this.repo
      .createQueryBuilder('a')
      .addSelect('a.image')
      .where('a.acta_id = :actaId', { actaId })
      .orderBy('a.position', 'ASC')
      .addOrderBy('a.id', 'ASC')
      .getMany();
  }

  async image(id: number): Promise<{ image: Buffer; mime: string } | null> {
    const a = await this.repo.createQueryBuilder('a').addSelect('a.image').where('a.id = :id', { id }).getOne();
    return a?.image && a.imageMime ? { image: a.image, mime: a.imageMime } : null;
  }

  async create(
    actaId: number,
    fields: AnnexFields,
    file: { buffer: Buffer; mimetype: string } | null,
    user: AuthUser,
  ): Promise<AnnexView> {
    if (!(await this.actas.findOne({ where: { id: actaId } }))) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Acta no encontrada' });
    }
    const caption = String(fields.caption ?? '').trim();
    if (file) this.assertImage(file);
    if (!file && !caption) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: 'Agrega una foto, un texto o ambos.' });
    }
    const last = (await this.repo.find({ where: { actaId }, order: { position: 'ASC' } })).at(-1);
    const saved = await this.repo.save(
      this.repo.create({
        actaId,
        position: (last?.position ?? 0) + 1,
        section: fields.section?.trim().slice(0, 40) || null,
        place: fields.place === 'INLINE' ? 'INLINE' : 'ANEXO',
        caption: caption || null,
        image: file?.buffer ?? null,
        imageMime: file?.mimetype ?? null,
        createdByUserId: user.id,
      }),
    );
    return view(saved);
  }

  async update(id: number, fields: AnnexFields & { position?: number }): Promise<AnnexView> {
    const a = await this.repo.findOne({ where: { id } });
    if (!a) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Evidencia no encontrada' });
    if (fields.caption !== undefined) a.caption = fields.caption.trim() || null;
    if (fields.place) a.place = fields.place === 'INLINE' ? 'INLINE' : 'ANEXO';
    if (fields.section !== undefined) a.section = fields.section.trim().slice(0, 40) || null;
    if (fields.position !== undefined && Number.isInteger(fields.position) && fields.position > 0) a.position = fields.position;
    if (!a.caption && !a.imageMime) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: 'Una evidencia sin foto necesita texto.' });
    }
    return view(await this.repo.save(a));
  }

  async remove(id: number): Promise<void> {
    const a = await this.repo.findOne({ where: { id } });
    if (!a) return;
    await this.repo.delete({ id });
    const rest = await this.repo.find({ where: { actaId: a.actaId }, order: { position: 'ASC', id: 'ASC' } });
    for (const [i, r] of rest.entries()) {
      if (r.position !== i + 1) {
        r.position = i + 1;
        await this.repo.save(r);
      }
    }
  }

  private assertImage(file: { buffer: Buffer; mimetype: string }): void {
    const magic = MAGIC[file.mimetype];
    if (!magic || !file.buffer?.subarray(0, magic.length / 2).toString('hex').startsWith(magic)) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: 'La foto debe ser JPEG o PNG.' });
    }
    if (file.buffer.length > MAX_ANNEX_IMAGE_BYTES) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: 'La foto pesa más de 5 MB.' });
    }
  }
}
