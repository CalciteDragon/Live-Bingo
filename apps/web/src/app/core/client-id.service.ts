import { Injectable } from '@angular/core';

const STORAGE_KEY = 'bingo_client_id';

@Injectable({ providedIn: 'root' })
export class ClientIdService {
  readonly clientId: string;

  constructor() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      this.clientId = stored;
    } else {
      this.clientId = crypto.randomUUID();
      localStorage.setItem(STORAGE_KEY, this.clientId);
    }
  }
}
