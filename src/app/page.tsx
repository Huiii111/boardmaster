import { LabShell } from '@/components/layout/LabShell';

/**
 * The laboratory is a single desktop-class workspace. All interactive state
 * lives in the client store, so this page is a thin server shell.
 */
export default function HomePage() {
  return <LabShell />;
}
