export interface InspectionStep {
  id: string;
  title: string;
  description: string;
  guidance: string[];
}

export const INSPECTION_STEPS: InspectionStep[] = [
  {
    id: 'front',
    title: 'Front of House',
    description: 'Photograph the full front elevation of the property.',
    guidance: [
      'Ensure the entire facade is visible including roof line, fascia, and entry',
      'Stand far enough back to capture the full width of the home',
      'Include the driveway and any visible landscaping damage',
    ],
  },
  {
    id: 'left_side',
    title: 'Left Side',
    description: 'Capture the full left side of the property.',
    guidance: [
      'Stand at the front-left corner facing the side wall',
      'Capture the full left side wall, eave, and any visible roof planes',
      'Note any AC units, meters, or obstructions',
    ],
  },
  {
    id: 'right_side',
    title: 'Right Side',
    description: 'Capture the full right side of the property.',
    guidance: [
      'Stand at the front-right corner facing the side wall',
      'Same approach as the left side photo',
      'Note any AC units, meters, or obstructions',
    ],
  },
  {
    id: 'rear',
    title: 'Rear of House',
    description: 'Capture the full back elevation of the property.',
    guidance: [
      'Include patio covers, rear roof slopes, and any additions',
      'Photograph any back porches, decks, or overhangs',
      'Stand far enough back to capture the full rear view',
    ],
  },
  {
    id: 'gutters',
    title: 'Gutters (Soft Metals)',
    description: 'Close-up of gutters to document damage.',
    guidance: [
      'Look for dents, dings, or bent sections caused by hail or wind debris',
      'Photograph multiple sections if damage varies',
      'Include a reference object (pen, coin) for scale if possible',
    ],
  },
  {
    id: 'downspouts',
    title: 'Downspouts',
    description: 'Photograph downspouts from top to bottom.',
    guidance: [
      'Look for dents, kinks, or detachment from the wall',
      'Check where downspouts connect to gutters',
      'Note any missing or broken sections',
    ],
  },
  {
    id: 'window_wraps',
    title: 'Window Wraps / Trim',
    description: 'Close-up of window trim and wraps.',
    guidance: [
      'Look for dents, cracks, or chipped paint from impact',
      'Photograph multiple windows if damage varies',
      'Include both the trim and surrounding area',
    ],
  },
  {
    id: 'window_screens',
    title: 'Window Screens',
    description: 'Photograph window screens for damage.',
    guidance: [
      'Look for tears, holes, or bent frames from hail or debris',
      'Photograph the screen from the outside if possible',
      'Note screens that are missing entirely',
    ],
  },
  {
    id: 'siding',
    title: 'Siding',
    description: 'Capture siding sections showing condition.',
    guidance: [
      'Look for cracks, chips, hail splatter marks, or loose panels',
      'Photograph at an angle to show texture and depth of damage',
      'Document multiple areas if damage is widespread',
    ],
  },
  {
    id: 'roof',
    title: 'Roof',
    description: 'Photograph key roof components and any damage.',
    guidance: [
      'Capture ridge cap, vents, pipe jacks, valleys, and penetrations',
      'Note missing or damaged shingles',
      'If safely accessible, photograph from the roof; otherwise from ground level',
    ],
  },
  {
    id: 'additional',
    title: 'Additional / Misc Damage',
    description: 'Capture any other damage not covered in previous steps.',
    guidance: [
      'Use notes to describe what you are documenting',
      'This step is optional — skip if no additional damage found',
      'Include fences, sheds, outdoor equipment, or any other structures',
    ],
  },
];
