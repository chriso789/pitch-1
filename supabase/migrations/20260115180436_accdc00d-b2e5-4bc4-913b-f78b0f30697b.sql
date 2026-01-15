-- Normalize existing tag placements from canvas (1.5x) to PDF (1x) coordinates
UPDATE document_tag_placements
SET 
  x_position = x_position / 1.5,
  y_position = y_position / 1.5,
  width = width / 1.5,
  height = height / 1.5
WHERE x_position IS NOT NULL;