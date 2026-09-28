import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { APP_INITIALIZER, NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { authInterceptor } from './core/auth.interceptor';
import { AuthService } from './core/auth.service';
import { ConfirmDialogComponent } from './shared/confirm-dialog.component';
import { ToastContainerComponent } from './shared/toast-container.component';

/** Restores a saved session (user, restaurants, active restaurant) before the first route loads. */
function restoreSession(auth: AuthService) {
  return () => auth.restore();
}

@NgModule({
  declarations: [AppComponent],
  imports: [BrowserModule, AppRoutingModule, ToastContainerComponent, ConfirmDialogComponent],
  providers: [
    provideHttpClient(withInterceptors([authInterceptor])),
    { provide: APP_INITIALIZER, useFactory: restoreSession, deps: [AuthService], multi: true },
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
