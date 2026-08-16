# Version Template Variants instead of mutating them

Tesla can change a catalog entry or template asset without supplying a stable compatibility version. WrapForge therefore records each verified source revision as an immutable Template Variant, marks superseded revisions as Legacy Template Variants, and permits new Wraps only against the Active Template Variant. Existing Wraps keep the exact revision they were created for, preserving an auditable Compatibility Claim instead of silently rewriting history when Tesla's catalog changes.
