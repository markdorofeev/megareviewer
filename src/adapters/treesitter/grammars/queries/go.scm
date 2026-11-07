; Definitions. Package-level variables and constants are visible to the whole package.

(function_declaration name: (identifier) @name) @definition.function
(method_declaration name: (field_identifier) @name) @definition.method
(type_declaration (type_spec name: (type_identifier) @name type: (struct_type)) @definition.class)
(type_declaration (type_spec name: (type_identifier) @name) @definition.type)
(type_declaration (type_alias name: (type_identifier) @name) @definition.type)
(source_file (var_declaration (var_spec name: (identifier) @name) @definition.variable))
(source_file (const_declaration (const_spec name: (identifier) @name) @definition.variable))

; References. A composite literal builds a value, so its type is used, not just named.

(call_expression function: (identifier) @reference.name)
(composite_literal type: (type_identifier) @reference.name)
(composite_literal type: (qualified_type name: (type_identifier) @reference.member))
(selector_expression operand: (identifier) @reference.name)
(selector_expression field: (field_identifier) @reference.member)
(type_identifier) @reference.type

; Imports

(import_spec path: (interpreted_string_literal (interpreted_string_literal_content) @import.module))
