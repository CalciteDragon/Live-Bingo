import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { clientIdInterceptor } from './client-id.interceptor';
import { ClientIdService } from './client-id.service';

describe('clientIdInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  let clientId: string;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([clientIdInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http        = TestBed.inject(HttpClient);
    controller  = TestBed.inject(HttpTestingController);
    clientId    = TestBed.inject(ClientIdService).clientId;
  });

  afterEach(() => {
    controller.verify();
    localStorage.clear();
  });

  it('attaches X-Client-Id header to every request', () => {
    http.get('/api/test').subscribe();
    const req = controller.expectOne('/api/test');
    expect(req.request.headers.get('X-Client-Id')).toBe(clientId);
    req.flush({});
  });

  it('does not alter other headers', () => {
    http.get('/api/test', { headers: { 'X-Custom': 'value' } }).subscribe();
    const req = controller.expectOne('/api/test');
    expect(req.request.headers.get('X-Custom')).toBe('value');
    req.flush({});
  });
});
