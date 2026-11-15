'use client';

import { Suspense, type ComponentProps } from 'react';
import { Text } from '@react-three/drei';

/**
 * A 3D text label that can never take the scene down with it.
 *
 * drei's `<Text>` calls `suspend()` while it preloads a font, and troika
 * resolves its default font from a jsdelivr CDN at runtime. Without a boundary,
 * a blocked or slow CDN would suspend the surrounding scene subtree and the
 * student would see an empty bench rather than a breadboard.
 *
 * Wrapping each label in its own `Suspense` with a null fallback isolates that:
 * if fonts are unavailable the board, components and wires all still render and
 * stay fully interactive, and only the engraved text is missing.
 *
 * Note that no *essential* information is carried by text alone — the LED's
 * cathode is marked by its flat flange and shorter lead, the supply posts are
 * colour-coded red/black, and the rails have painted polarity stripes.
 */
export function SafeText(props: ComponentProps<typeof Text>) {
  return (
    <Suspense fallback={null}>
      <Text {...props} />
    </Suspense>
  );
}
