import { parseEmailList } from './workspace.service';

describe('parseEmailList', () => {
  it('separa por coma, punto y coma o espacios, en minúsculas y sin repetidos', () => {
    expect(parseEmailList(' Frank@Kuboti.com, otro@x.pe;frank@kuboti.com  tres@y.pe ')).toEqual(['frank@kuboti.com', 'otro@x.pe', 'tres@y.pe']);
    expect(parseEmailList('')).toEqual([]);
  });
});
