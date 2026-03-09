import { TestBed } from '@angular/core/testing';
import { BingoCellComponent } from './bingo-cell';
import type { Cell } from '@bingo/shared';

function makeCell(overrides: Partial<Cell> = {}): Cell {
  return { index: 0, goal: 'Mine Diamonds', markedBy: null, ...overrides };
}

afterEach(() => TestBed.resetTestingModule());

describe('BingoCellComponent — CSS classes', () => {
  it('has no marker classes when cell is unmarked', () => {
    const fixture = TestBed.createComponent(BingoCellComponent);
    fixture.componentRef.setInput('cell', makeCell());
    fixture.componentRef.setInput('myPlayerId', 'p1');
    fixture.componentRef.setInput('isActive', true);
    fixture.detectChanges();

    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(btn.classList.contains('bingo-cell--self')).toBe(false);
    expect(btn.classList.contains('bingo-cell--opponent')).toBe(false);
  });

  it('adds bingo-cell--self when marked by me', () => {
    const fixture = TestBed.createComponent(BingoCellComponent);
    fixture.componentRef.setInput('cell', makeCell({ markedBy: 'p1' }));
    fixture.componentRef.setInput('myPlayerId', 'p1');
    fixture.componentRef.setInput('isActive', true);
    fixture.detectChanges();

    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(btn.classList.contains('bingo-cell--self')).toBe(true);
    expect(btn.classList.contains('bingo-cell--opponent')).toBe(false);
  });

  it('adds bingo-cell--opponent when marked by opponent', () => {
    const fixture = TestBed.createComponent(BingoCellComponent);
    fixture.componentRef.setInput('cell', makeCell({ markedBy: 'p2' }));
    fixture.componentRef.setInput('myPlayerId', 'p1');
    fixture.componentRef.setInput('isActive', true);
    fixture.detectChanges();

    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(btn.classList.contains('bingo-cell--self')).toBe(false);
    expect(btn.classList.contains('bingo-cell--opponent')).toBe(true);
  });

  it('adds bingo-cell--inactive when isActive is false', () => {
    const fixture = TestBed.createComponent(BingoCellComponent);
    fixture.componentRef.setInput('cell', makeCell());
    fixture.componentRef.setInput('myPlayerId', 'p1');
    fixture.componentRef.setInput('isActive', false);
    fixture.detectChanges();

    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(btn.classList.contains('bingo-cell--inactive')).toBe(true);
  });

  it('does not add bingo-cell--inactive when isActive is true', () => {
    const fixture = TestBed.createComponent(BingoCellComponent);
    fixture.componentRef.setInput('cell', makeCell());
    fixture.componentRef.setInput('myPlayerId', 'p1');
    fixture.componentRef.setInput('isActive', true);
    fixture.detectChanges();

    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(btn.classList.contains('bingo-cell--inactive')).toBe(false);
  });
});

describe('BingoCellComponent — click emission', () => {
  it('emits cellClick with cell.index when active', () => {
    const fixture = TestBed.createComponent(BingoCellComponent);
    fixture.componentRef.setInput('cell', makeCell({ index: 7 }));
    fixture.componentRef.setInput('myPlayerId', 'p1');
    fixture.componentRef.setInput('isActive', true);
    fixture.detectChanges();

    const emitted: number[] = [];
    fixture.componentInstance.cellClick.subscribe((idx: number) => emitted.push(idx));

    fixture.nativeElement.querySelector('button').click();

    expect(emitted).toEqual([7]);
  });

  it('does not emit cellClick when inactive', () => {
    const fixture = TestBed.createComponent(BingoCellComponent);
    fixture.componentRef.setInput('cell', makeCell({ index: 7 }));
    fixture.componentRef.setInput('myPlayerId', 'p1');
    fixture.componentRef.setInput('isActive', false);
    fixture.detectChanges();

    const emitted: number[] = [];
    fixture.componentInstance.cellClick.subscribe((idx: number) => emitted.push(idx));

    fixture.nativeElement.querySelector('button').click();

    expect(emitted).toEqual([]);
  });

  it('renders the cell goal text', () => {
    const fixture = TestBed.createComponent(BingoCellComponent);
    fixture.componentRef.setInput('cell', makeCell({ goal: 'Kill the Ender Dragon' }));
    fixture.componentRef.setInput('myPlayerId', 'p1');
    fixture.componentRef.setInput('isActive', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Kill the Ender Dragon');
  });
});
