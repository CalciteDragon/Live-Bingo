import { Component, input, output } from '@angular/core';
import type { Cell } from '@bingo/shared';

@Component({
  selector: 'app-bingo-cell',
  standalone: true,
  template: `
    <button
      class="bingo-cell"
      [class.bingo-cell--marked]="cell().markedBy !== null"
      [style]="cellStyle()"
      [class.bingo-cell--inactive]="!isActive()"
      (click)="onClick()"
    >
      <span class="bingo-cell__goal">{{ cell().goal }}</span>
    </button>
  `,
})
export class BingoCellComponent {
  readonly cell            = input.required<Cell>();
  readonly playerColorMap  = input.required<Record<string, string>>();
  readonly isActive        = input.required<boolean>();

  readonly cellClick = output<number>();

  protected cellColor(): string | null {
    const m = this.cell().markedBy;
    return m ? (this.playerColorMap()[m] ?? null) : null;
  }

  get difficultyColor(): string {
    const hue = (1 - this.cell().difficulty) * 120;
    return `hsl(${hue}, 70%, 50%)`;
  }

  protected cellStyle(): Record<string, string> {
    const color = this.cellColor();
    return {
      ...(color ? { '--cell-color': color } : {}),
      '--difficulty-color': this.difficultyColor,
    };
  }

  protected onClick(): void {
    if (!this.isActive()) return;
    this.cellClick.emit(this.cell().index);
  }
}
