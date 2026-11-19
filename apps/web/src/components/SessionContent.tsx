import { memo, type ComponentType, type LazyExoticComponent } from 'react';

/** Isi sesi tidak ikut re-render saat tab lain diaktifkan; elemennya tetap sama. */
export const SessionContent = memo(function SessionContent({
  component: Component,
}: {
  component: LazyExoticComponent<ComponentType>;
}) {
  return <Component />;
});
