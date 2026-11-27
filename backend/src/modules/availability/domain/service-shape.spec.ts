import { serviceShapeError } from './service-shape';

describe('serviceShapeError', () => {
  it('HTTPS exige https://', () => {
    expect(serviceShapeError('HTTPS', 'https://prosol.kuboapp.com/identity', null)).toBeNull();
    expect(serviceShapeError('HTTPS', 'http://147.93.146.92:8080/', null)).toBe('HTTPS_URL');
  });

  it('HTTP exige http:// (el puerto va en la URL)', () => {
    expect(serviceShapeError('HTTP', 'http://147.93.146.92:8080/financobro/cobranza/login.aspx', null)).toBeNull();
    expect(serviceShapeError('HTTP', 'https://prosol.kuboapp.com/', null)).toBe('HTTP_URL');
    expect(serviceShapeError('HTTP', '147.93.146.92', null)).toBe('HTTP_URL');
  });

  it('ICMP (ping) solo admite un host o una IP, no una URL', () => {
    expect(serviceShapeError('ICMP', '147.93.146.92', null)).toBeNull();
    expect(serviceShapeError('ICMP', 'prosol.kuboapp.com', null)).toBeNull();
    expect(serviceShapeError('ICMP', 'http://147.93.146.92/financobro', null)).toBe('ICMP_HOST');
    expect(serviceShapeError('ICMP', '147.93.146.92:8080', null)).toBe('ICMP_HOST');
  });

  it('TCP exige un puerto 1-65535', () => {
    expect(serviceShapeError('TCP', '147.93.146.129', 1433)).toBeNull();
    expect(serviceShapeError('TCP', '147.93.146.129', null)).toBe('TCP_PORT');
    expect(serviceShapeError('TCP', '147.93.146.129', 70000)).toBe('TCP_PORT');
  });
});
