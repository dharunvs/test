# Branchline Documentation Index

Last validated: 2026-03-10  
Project: Branchline  
Scope: Product strategy, feature blueprint, implementation guideline, technical architecture and data model

---

## Documentation Structure

```text
docs/
  README.md
  01_strategy/
    01_problem_landscape_and_opportunities.md
    02_pain_points_and_feature_blueprint.md
  02_product/
    01_complete_project_guideline.md
  03_technical/
    01_tech_stack_and_data_model_spec.md
  04_delivery/
    01_feature_acceptance_matrix.md
    02_end_to_end_completion_plan.md
    03_feature_gate_manifest.json
    03_manual_runbooks.md
    04_live_input_contract.json
```

---

## Document Catalog

| Order | Document                                                | Purpose                                                                                                              |
| ----- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1     | `01_strategy/01_problem_landscape_and_opportunities.md` | Market/problem landscape, pain points, opportunities, and product direction context.                                 |
| 2     | `01_strategy/02_pain_points_and_feature_blueprint.md`   | Pain-point list mapped to concrete product additions, module structure, and flow diagrams.                           |
| 3     | `02_product/01_complete_project_guideline.md`           | End-to-end project guideline: features, implementation approach, roadmap, KPIs, security, and delivery plan.         |
| 4     | `03_technical/01_tech_stack_and_data_model_spec.md`     | Detailed technical stack decisions, backend/service architecture, and database model specification for all features. |
| 5     | `04_delivery/01_feature_acceptance_matrix.md`           | Feature-by-feature acceptance matrix linking F1-F16 to automated and manual validation checks.                       |
| 6     | `04_delivery/02_end_to_end_completion_plan.md`          | Execution-ready implementation and validation plan to close remaining end-to-end gaps from current baseline.         |
| 7     | `04_delivery/03_feature_gate_manifest.json`             | CI-enforced feature gate manifest mapping F1-F16 to automated test IDs and manual runbook IDs.                       |
| 8     | `04_delivery/03_manual_runbooks.md`                     | Scripted manual validation runbooks for F1-F16 acceptance and release-gate checks.                                    |
| 9     | `04_delivery/04_live_input_contract.json`               | Canonical strict-lane live input contract consumed by preflight validation in CI/staging gates.                       |

---

## Recommended Reading Sequence

1. Read strategy docs first (`01_strategy`) to align on problem and solution framing.
2. Read product guideline (`02_product`) for implementation-level product scope and rollout sequence.
3. Read technical spec (`03_technical`) for engineering execution and schema-level implementation details.

---

## Rename and Organization Map

No content was intentionally removed from original docs. Files were renamed and organized for clarity.

| Previous Name                                        | New Location                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| `ai_native_dev_pain_points_and_opportunities.md`     | `docs/01_strategy/01_problem_landscape_and_opportunities.md` |
| `ai_native_dev_pain_points_and_project_additions.md` | `docs/01_strategy/02_pain_points_and_feature_blueprint.md`   |
| `ai_native_collab_complete_project_guideline.md`     | `docs/02_product/01_complete_project_guideline.md`           |
| `ai_native_collab_tech_stack_and_data_models.md`     | `docs/03_technical/01_tech_stack_and_data_model_spec.md`     |

---

## Validation Checklist (Completed)

1. Verified all docs are grouped by purpose (`strategy`, `product`, `technical`).
2. Updated stale root-structure references from `collab/` to `branchline/` in architecture sections.
3. Standardized top-level metadata fields (version/date/status/project where applicable).
4. Confirmed all four core docs are present and readable.
5. Confirmed there are no references to removed old filenames inside current docs.

---

## Documentation Conventions

1. Use numbered files (`01_`, `02_`) to preserve reading order.
2. Keep strategic docs in `01_strategy/`, execution docs in `02_product/`, and engineering specs in `03_technical/`.
3. When adding a new doc, include:
   1. Version.
   2. Date.
   3. Status.
   4. Intended audience.
4. Update this index when files are added or renamed.

---

## Next Recommended Docs (Optional)

1. `04_delivery/01_mvp_execution_plan_90_days.md`
2. `04_delivery/02_api_contracts_openapi_overview.md`
3. `05_operations/01_runbook_incident_and_recovery.md`
