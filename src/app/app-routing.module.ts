import { NgModule } from '@angular/core';
import { Route, RouterModule, Routes } from '@angular/router';
import { authGuard, guestGuard, roleGuard, tenantGuard } from './core/guards';
import { Role } from './core/enums';

/**
 * A feature page. `roles` mirror the backend's requireRole() for the page's main purpose;
 * an empty list means any member of the restaurant (the API allows every member to read it).
 */
function page(path: string, title: string, loadComponent: Route['loadComponent'], roles: Role[] = []): Route {
  return { path, canActivate: [roleGuard], data: { title, roles }, loadComponent };
}

const FLOOR: Role[] = ['manager', 'cashier', 'waiter'];
const KITCHEN: Role[] = ['manager', 'chef', 'waiter'];
const TILL: Role[] = ['manager', 'cashier'];
const BUYER: Role[] = ['manager', 'inventory_clerk'];

const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    title: 'Sign in · Restaurant OS',
    loadComponent: () => import('./pages/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    title: 'Create restaurant · Restaurant OS',
    loadComponent: () => import('./pages/register/register.component').then((m) => m.RegisterComponent),
  },
  {
    path: 'select-restaurant',
    canActivate: [authGuard],
    title: 'Choose restaurant · Restaurant OS',
    loadComponent: () =>
      import('./pages/select-restaurant/select-restaurant.component').then((m) => m.SelectRestaurantComponent),
  },
  {
    path: '',
    canActivate: [authGuard, tenantGuard],
    loadComponent: () => import('./layout/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      page('dashboard', 'Dashboard', () => import('./pages/dashboard/dashboard.component').then((m) => m.DashboardComponent)),
      page('pos', 'Point of Sale', () => import('./pages/pos/pos.component').then((m) => m.PosComponent), FLOOR),
      page('orders', 'Orders', () => import('./pages/orders/orders-list.component').then((m) => m.OrdersListComponent)),
      page('orders/:id', 'Order', () => import('./pages/orders/order-detail.component').then((m) => m.OrderDetailComponent)),
      page('tables', 'Tables', () => import('./pages/tables/tables.component').then((m) => m.TablesComponent)),
      page('kitchen', 'Kitchen Display', () => import('./pages/kitchen/kitchen.component').then((m) => m.KitchenComponent), KITCHEN),
      page('menu', 'Menu', () => import('./pages/menu/menu.component').then((m) => m.MenuComponent)),
      page('inventory', 'Inventory', () => import('./pages/inventory/inventory.component').then((m) => m.InventoryComponent)),
      page('suppliers', 'Suppliers', () => import('./pages/suppliers/suppliers.component').then((m) => m.SuppliersComponent)),
      page('purchase-orders', 'Purchase Orders', () =>
        import('./pages/purchasing/purchase-orders-list.component').then((m) => m.PurchaseOrdersListComponent)
      ),
      page(
        'purchase-orders/new',
        'New Purchase Order',
        () => import('./pages/purchasing/purchase-order-form.component').then((m) => m.PurchaseOrderFormComponent),
        BUYER
      ),
      page('purchase-orders/:id', 'Purchase Order', () =>
        import('./pages/purchasing/purchase-order-detail.component').then((m) => m.PurchaseOrderDetailComponent)
      ),
      page('payments', 'Payments', () => import('./pages/payments/payments.component').then((m) => m.PaymentsComponent), TILL),
      page('reports', 'Reports', () => import('./pages/reports/reports.component').then((m) => m.ReportsComponent), ['manager']),
      page('staff', 'Staff', () => import('./pages/staff/staff.component').then((m) => m.StaffComponent), ['manager']),
    ],
  },
  {
    path: '**',
    title: 'Not found · Restaurant OS',
    loadComponent: () => import('./pages/not-found.component').then((m) => m.NotFoundComponent),
  },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule {}
