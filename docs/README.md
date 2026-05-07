# Branchline Documentation Index

Last validated: 2026-03-17

## v0.1 Precedence Rules

For the hard pivot, treat the following as source-of-truth in this order:

1. `docs/05_pivot/*`
2. `DEMO.md`
3. `docs/04_delivery/03_feature_gate_manifest.json` and `docs/04_delivery/03_manual_runbooks.md`

If any older broad-scope docs conflict with the above, the pivot docs win.

## Active v0.1 Docs

- `docs/branchline_next_steps.md`: original pivot trigger note.
- `docs/05_pivot/README.md`: pivot index and operating rules.
- `docs/05_pivot/01_hard_pivot_decision_record.md`: locked decisions for v0.1.
- `docs/05_pivot/02_current_state_and_cutline.md`: keep/remove inventory and runtime cutline.
- `docs/05_pivot/03_intent_timeline_v01_spec.md`: API/web/extension wedge contract.
- `docs/05_pivot/04_execution_plan_14_days.md`: execution plan and acceptance closure.
- `docs/05_pivot/05_feedback_log_template.md`: interview logging template for 5-team validation.
- `docs/04_delivery/01_feature_acceptance_matrix.md`: W1-W5 acceptance mapping.
- `docs/04_delivery/03_feature_gate_manifest.json`: manifest-driven wedge gate contract.
- `docs/04_delivery/03_manual_runbooks.md`: manual runbooks for W1-W5.
- `DEMO.md`: 5-minute walkthrough script.

## Archived For v0.1 Reference

These docs are retained for historical context but are not implementation authority during the wedge phase:

- `docs/01_strategy/01_problem_landscape_and_opportunities.md`
- `docs/01_strategy/02_pain_points_and_feature_blueprint.md`
- `docs/02_product/01_complete_project_guideline.md`
- `docs/03_technical/01_tech_stack_and_data_model_spec.md`
- `docs/04_delivery/02_end_to_end_completion_plan.md`
- `docs/04_delivery/04_live_input_contract.json`

## Folder Layout

```text
docs/
  README.md
  branchline_next_steps.md
  01_strategy/      # archived for v0.1 reference
  02_product/       # archived for v0.1 reference
  03_technical/     # archived for v0.1 reference
  04_delivery/      # active wedge gates + archived broad plan
  05_pivot/         # active source-of-truth for v0.1
```
