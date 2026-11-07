; Definitions. Earlier patterns win, so a function assigned to a variable is a function.

(function_declaration name: (identifier) @name) @definition.function
(generator_function_declaration name: (identifier) @name) @definition.function
(variable_declarator
  name: (identifier) @name
  value: [(arrow_function) (function_expression) (generator_function)]) @definition.function
(method_definition name: (property_identifier) @name) @definition.method
(class_declaration name: (identifier) @name) @definition.class
(program (lexical_declaration (variable_declarator name: (identifier) @name) @definition.variable))
(program (variable_declaration (variable_declarator name: (identifier) @name) @definition.variable))
(export_statement
  declaration: (lexical_declaration (variable_declarator name: (identifier) @name) @definition.variable))
(export_statement
  declaration: (variable_declaration (variable_declarator name: (identifier) @name) @definition.variable))

; References

(call_expression function: (identifier) @reference.name)
(new_expression constructor: (identifier) @reference.name)
(class_heritage (identifier) @reference.name)
(member_expression object: (identifier) @reference.name)
(member_expression property: (property_identifier) @reference.member)

; Imports

(import_statement
  (import_clause (named_imports (import_specifier name: (identifier) @import.name)))
  source: (string (string_fragment) @import.module))
(import_statement (import_clause (identifier)) source: (string (string_fragment) @import.module))
(import_statement
  (import_clause (namespace_import))
  source: (string (string_fragment) @import.module))
(call_expression
  function: (identifier) @_require
  arguments: (arguments . (string (string_fragment) @import.module) .)
  (#eq? @_require "require"))
