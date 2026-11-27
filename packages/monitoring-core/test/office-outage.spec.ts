import { isOfficeOutage } from '../src/office-outage';

describe('isOfficeOutage', () => {
  it('detecta caída con referencias caídas y mitad de destinos caídos', () => {
    expect(isOfficeOutage([false, false], [false, false, true, true])).toBe(true);
  });
  it('no es caída si alguna referencia responde', () => {
    expect(isOfficeOutage([false, true], [false, false])).toBe(false);
  });
  it('no es caída si caen menos de ceil(n/2) destinos', () => {
    expect(isOfficeOutage([false, false], [false, true, true])).toBe(false);
  });
  it('sin destinos o sin referencias no hay caída', () => {
    expect(isOfficeOutage([false], [])).toBe(false);
    expect(isOfficeOutage([], [false])).toBe(false);
  });
});
