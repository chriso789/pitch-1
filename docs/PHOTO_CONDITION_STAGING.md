# Condition persistence and staging approval

The class-validator expansion was applied during this work. No RLS policies were altered, but staging approval was not obtained first. This is a process exception, not evidence of authenticated acceptance.

The remaining SQL changes below are proposed locally only. Apply only after staging checks and explicit approval; preserve company access, independent reviewers, immutable originals/datasets and existing promotion gates.

1. Label-save: retain region semantics (normal, maintenance, damage, uncertain, not assessable); allow normal regions with the legacy no-visible-damage flag only if every region is normal. Reject maintenance/damage/uncertainty with that flag. Existing server already rejects empty non-negative submissions.
2. Dataset-create: preserve approved review-only photos in the immutable manifest; define classes from normal/damage/maintenance only. Mark uncertain/not-assessable photos review-only; never label them negative. Exports and local worker now enforce this exclusion themselves.
3. Evaluation: exclude review-only photos from ground truth and refuse predictions on them or uncertain class IDs. Initialize expected system/class support; count all defect predictions on normal-only/negative photographs as false positives. Keep per-class P/R/TP/FP/FN; add normal-photo false-positive count, bbox IoU and calibration evidence. Polygon accuracy, material identification and component-stage metrics remain unavailable until those stages exist.
4. Activation: reject old/unsafe condition evaluations; require test-partition provenance, all intended supported system/classes, independently verified execution and licensing plus current support/P/R gates. Registry activation does not install a worker model.

Staging acceptance: two-company isolation; normal/maintenance/uncertain save→second-inspector review→immutable dataset; uncertain photo excluded from optimizer and evaluation; false defect on a normal photo counted FP; missing genuine defect counted FN; training-property predictions refused; promotion blocked below gates. None of these authenticated SQL cases have been performed here.