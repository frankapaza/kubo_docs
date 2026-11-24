import { nearestCorner, positionFor, windowHeight, BAR_HEIGHT, ROW_HEIGHT, WIDTH } from '../src/shared/window-position';

const WA = { x: 0, y: 0, width: 1920, height: 1040 };
const SIZE = { width: 320, height: 40 };

describe('positionFor', () => {
  it('places the window in each corner with a 12 px margin', () => {
    expect(positionFor('top-left', WA, SIZE, 12)).toEqual({ x: 12, y: 12 });
    expect(positionFor('top-right', WA, SIZE, 12)).toEqual({ x: 1920 - 320 - 12, y: 12 });
    expect(positionFor('bottom-left', WA, SIZE, 12)).toEqual({ x: 12, y: 1040 - 40 - 12 });
    expect(positionFor('bottom-right', WA, SIZE, 12)).toEqual({ x: 1920 - 320 - 12, y: 1040 - 40 - 12 });
  });

  it('defaults to a 12 px margin and honours the work area offset', () => {
    const wa = { x: -1280, y: 100, width: 1280, height: 900 };
    expect(positionFor('top-left', wa, SIZE)).toEqual({ x: -1268, y: 112 });
    expect(positionFor('bottom-right', wa, SIZE)).toEqual({ x: -1280 + 1280 - 320 - 12, y: 100 + 900 - 40 - 12 });
  });
});

describe('nearestCorner', () => {
  it('picks the corner of the quadrant holding the window centre', () => {
    expect(nearestCorner({ x: 100, y: 100, width: 320, height: 40 }, WA)).toBe('top-left');
    expect(nearestCorner({ x: 1500, y: 50, width: 320, height: 40 }, WA)).toBe('top-right');
    expect(nearestCorner({ x: 10, y: 900, width: 320, height: 40 }, WA)).toBe('bottom-left');
    expect(nearestCorner({ x: 1200, y: 700, width: 320, height: 40 }, WA)).toBe('bottom-right');
  });
});

describe('windowHeight', () => {
  it('is the bar alone when collapsed', () => {
    expect(WIDTH).toBe(320);
    expect(windowHeight({ expanded: false, rows: 3, summary: false, health: false })).toBe(BAR_HEIGHT);
  });

  it('adds 56 per row up to 6 rows', () => {
    expect(ROW_HEIGHT).toBe(56);
    expect(windowHeight({ expanded: true, rows: 2, summary: false, health: false })).toBe(40 + 112);
    expect(windowHeight({ expanded: true, rows: 9, summary: false, health: false })).toBe(40 + 6 * 56);
  });

  it('adds room for the summary and health panels', () => {
    const base = windowHeight({ expanded: false, rows: 0, summary: false, health: false });
    expect(windowHeight({ expanded: false, rows: 0, summary: true, health: false })).toBeGreaterThan(base);
    expect(windowHeight({ expanded: false, rows: 0, summary: false, health: true })).toBeGreaterThan(base);
  });
});
