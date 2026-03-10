import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { ClientIdService } from './client-id.service';

export const clientIdInterceptor: HttpInterceptorFn = (req, next) => {
  const clientId = inject(ClientIdService).clientId;
  return next(req.clone({ setHeaders: { 'X-Client-Id': clientId } }));
};
