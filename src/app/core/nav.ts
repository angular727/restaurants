import { Role } from './enums';

export interface NavItem {
  label: string;
  icon: string;
  path: string;
  /** Who sees the link. Empty = every member. Owners and admins always see it. */
  roles: Role[];
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

/**
 * Sidebar structure. The role lists match the backend's requireRole() guards,
 * so staff only see the modules the API lets them use.
 */
export const NAV: NavSection[] = [
  {
    title: 'Overview',
    items: [{ label: 'Dashboard', icon: 'bi-grid-1x2', path: '/dashboard', roles: [] }],
  },
  {
    title: 'Service',
    items: [
      { label: 'Point of Sale', icon: 'bi-display', path: '/pos', roles: ['manager', 'cashier', 'waiter'] },
      { label: 'Orders', icon: 'bi-receipt', path: '/orders', roles: [] },
      { label: 'Tables', icon: 'bi-grid-3x3-gap', path: '/tables', roles: [] },
      { label: 'Kitchen Display', icon: 'bi-fire', path: '/kitchen', roles: ['manager', 'chef', 'waiter'] },
    ],
  },
  {
    title: 'Catalog',
    items: [{ label: 'Menu', icon: 'bi-journal-text', path: '/menu', roles: [] }],
  },
  {
    title: 'Back Office',
    items: [
      { label: 'Inventory', icon: 'bi-box-seam', path: '/inventory', roles: [] },
      { label: 'Suppliers', icon: 'bi-truck', path: '/suppliers', roles: [] },
      { label: 'Purchase Orders', icon: 'bi-clipboard-check', path: '/purchase-orders', roles: [] },
    ],
  },
  {
    title: 'Finance',
    items: [
      { label: 'Payments', icon: 'bi-credit-card-2-front', path: '/payments', roles: ['manager', 'cashier'] },
      { label: 'Reports', icon: 'bi-bar-chart-line', path: '/reports', roles: ['manager'] },
    ],
  },
  {
    title: 'Administration',
    items: [{ label: 'Staff', icon: 'bi-people', path: '/staff', roles: ['manager'] }],
  },
];
