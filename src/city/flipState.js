// Flip progress shared between App's Flipper (writer) and the city's light rig
// (reader): 0 = meadow at rest, 1 = city at rest. Module singleton, no React.
export const flipState = { p: 0 }
