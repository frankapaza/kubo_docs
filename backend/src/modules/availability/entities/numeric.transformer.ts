import { ValueTransformer } from 'typeorm';

/** DECIMAL llega como string desde mysql2: se entrega como número. */
export const decimalANumero: ValueTransformer = {
  to: (v: number | null | undefined) => v,
  from: (v: string | number | null) => (v === null || v === undefined ? null : Number(v)),
};
