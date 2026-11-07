; Definitions

(method_declaration name: (identifier) @name) @definition.method
(constructor_declaration name: (identifier) @name) @definition.method
(class_declaration name: (identifier) @name) @definition.class
(record_declaration name: (identifier) @name) @definition.class
(enum_declaration name: (identifier) @name) @definition.type
(interface_declaration name: (identifier) @name) @definition.type
(annotation_type_declaration name: (identifier) @name) @definition.type
(field_declaration declarator: (variable_declarator name: (identifier) @name)) @definition.variable

; References. Earlier patterns win, so a constructed class is used, not just named.

(object_creation_expression type: (type_identifier) @reference.name)
(method_invocation !object name: (identifier) @reference.name)
(method_invocation name: (identifier) @reference.member)
(method_invocation object: (identifier) @reference.name)
(field_access object: (identifier) @reference.name)
(field_access field: (identifier) @reference.member)
(type_identifier) @reference.type

; Imports. A wildcard import names "*".

(import_declaration (scoped_identifier) @import.module (asterisk) @import.name)
(import_declaration (scoped_identifier) @import.module .)
