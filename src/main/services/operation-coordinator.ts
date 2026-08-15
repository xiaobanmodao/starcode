import type { OperationKind } from '../../shared/contracts';

export class OperationCoordinator {
  private current: OperationKind = 'idle';

  acquire(kind: Exclude<OperationKind, 'idle'>): void {
    if (this.current !== 'idle') throw new Error(`当前正在${this.label(this.current)}，请先停止。`);
    this.current = kind;
  }

  release(kind: Exclude<OperationKind, 'idle'>): void {
    if (this.current === kind) this.current = 'idle';
  }

  get active(): OperationKind {
    return this.current;
  }

  private label(kind: OperationKind): string {
    return ({ idle: '空闲', building: '编译', running: '运行', testing: '测试', debugging: '调试' } as const)[kind];
  }
}
