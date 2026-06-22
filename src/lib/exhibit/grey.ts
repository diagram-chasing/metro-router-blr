// Grayscale display convention for the accumulation map.
//
// Each accumulated route is drawn in ONE of five greys, chosen by the route's
// grey bucket (see the carbon model in $lib/emissions). The rendered map can be
// captured and recoloured by luminance downstream, so the convention matters:
//
//   CONVENTION: brighter grey = dirtier route, on a black background.
//   bucket 0 (cleanest, e.g. walk/metro) -> dim grey
//   bucket 4 (dirtiest, e.g. solo cab)   -> near-white

/** Background the lines are drawn on when the base map is hidden. */
export const GREY_BG = '#000000';

/** Five greys, index = bucket. Brightness rises with emissions (see convention). */
export const GREY_SHADES = ['#404040', '#6e6e6e', '#9c9c9c', '#cacaca', '#f5f5f5'] as const;
