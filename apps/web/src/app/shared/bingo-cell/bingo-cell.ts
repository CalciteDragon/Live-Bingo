import { Component, input, output } from '@angular/core';
import type { Cell } from '@bingo/shared';

@Component({
  selector: 'app-bingo-cell',
  standalone: true,
  template: `
    <button
      class="bingo-cell"
      [class.bingo-cell--self]="isSelf()"
      [class.bingo-cell--opponent]="isOpponent()"
      [class.bingo-cell--inactive]="!isActive()"
      (click)="onClick()"
    >
      <span class="bingo-cell__goal">{{ cell().goal }}</span>
    </button>
  `,
})
export class BingoCellComponent {
  readonly cell       = input.required<Cell>();
  readonly myPlayerId = input.required<string>();
  readonly isActive   = input.required<boolean>();

  readonly cellClick = output<number>();

  protected isSelf(): boolean {
    return this.cell().markedBy === this.myPlayerId();
  }

  protected isOpponent(): boolean {
    const m = this.cell().markedBy;
    return m !== null && m !== this.myPlayerId();
  }

  protected onClick(): void {
    if (!this.isActive()) return;
    this.cellClick.emit(this.cell().index);
  }
}
