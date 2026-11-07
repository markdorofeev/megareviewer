; Definitions. Earlier patterns win, so a function in a class is a method.

(class_definition
  body: (block (function_definition name: (identifier) @name) @definition.method))
(class_definition
  body: (block (decorated_definition definition: (function_definition name: (identifier) @name) @definition.method)))
(function_definition name: (identifier) @name) @definition.function
(class_definition name: (identifier) @name) @definition.class
(module (expression_statement (assignment left: (identifier) @name) @definition.variable))

; References

(call function: (identifier) @reference.name)
(attribute object: (identifier) @reference.name)
(attribute attribute: (identifier) @reference.member)
(type (identifier) @reference.type)
(type (generic_type (identifier) @reference.type))

; Imports

(import_from_statement module_name: (_) @import.module name: (dotted_name) @import.name)
(import_from_statement
  module_name: (_) @import.module
  name: (aliased_import name: (dotted_name) @import.name))
(import_from_statement module_name: (_) @import.module (wildcard_import))
(import_statement name: (dotted_name) @import.module)
(import_statement name: (aliased_import name: (dotted_name) @import.module))
