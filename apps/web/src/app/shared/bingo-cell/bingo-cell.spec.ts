import { TestBed } from '@angular/core/testing';
import { BingoCellComponent } from './bingo-cell';
import type { Cell } from '@bingo/shared';

function makeCell(overrides: Partial<Cell> = {}): Cell {
  return { index: 0, goal: 'Mine Diamonds', markedBy: null, ...overrides };
}

afterEach(() => TestBed.resetTestingModule());

describe('BingoCellComponent — CSS classes and style', () => {
  it('has no bingo-cell--marked class and no --cell-color style when cell is unmarked', () => {
    const fixture = TestBed.createComponent(BingoCellComponent);
    fixture.componentRef.setInput('cell', makeCell());
    fixture.componentRef.setInput('playerColorMap', { p1: '#4a9eff' });
    fixture.componentRef.setInput('isActive', true);
    fixture.detectChanges();

    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(btn.classList.contains('bingo-cell--marked')).toBe(false);
    expect(btn.style.getPropertyValue('--cell-color')).toBe('');
  });

  it('has bingo-cell--marked and --cell-color #4a9eff when marked by p1', () => {
    const fixture = TestBed.createComponent(BingoCellComponent);
    fixture.componentRef.setInput('cell', makeCell({ markedBy: 'p1' }));
    fixture.componentRef.setInput('playerColorMap', { p1: '#4a9eff' });
    fixture.componentRef.setInput('isActive', true);
    fixture.detectChanges();

    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(btn.classList.contains('bingo-cell--marked')).toBe(true);
    expect(btn.style.getPropertyValue('--cell-color')).toBe('#4a9eff');
  });

  it('has --cell-color #51cf66 when marked by p3 (slot 3)', () => {
    const fixture = TestBed.createComponent(BingoCellComponent);
    fixture.componentRef.setInput('cell', makeCell({ markedBy: 'p3' }));
    fixture.componentRef.setInput('playerColorMap', { p3: '#51cf66' });
    fixture.componentRef.setInput('isActive', true);
    fixture.detectChanges();

    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(btn.classList.contains('bingo-cell--marked')).toBe(true);
    expect(btn.style.getPropertyValue('--cell-color')).toBe('#51cf66');
  });

  it('adds bingo-cell--inactive when isActive is false', () => {
    const fixture = TestBed.createComponent(BingoCellComponent);
    fixture.componentRef.setInput('cell', makeCell());
    fixture.componentRef.setInput('playerColorMap', {});
    fixture.componentRef.setInput('isActive', false);
    fixture.detectChanges();

    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(btn.classList.contains('bingo-cell--inactive')).toBe(true);
  });

  it('does not add bingo-cell--inactive when isActive is true', () => {
    const fixture = TestBed.createComponent(BingoCellComponent);
    fixture.componentRef.setInput('cell', makeCell());
    fixture.componentRef.setInput('playerColorMap', {});
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
    fixture.componentRef.setInput('playerColorMap', {});
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
    fixture.componentRef.setInput('playerColorMap', {});
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
    fixture.componentRef.setInput('playerColorMap', {});
    fixture.componentRef.setInput('isActive', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Kill the Ender Dragon');
  });
});
