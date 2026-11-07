; Definitions. Earlier patterns win, so a function in an impl or trait is a method.

(impl_item body: (declaration_list (function_item name: (identifier) @name) @definition.method))
(trait_item body: (declaration_list (function_item name: (identifier) @name) @definition.method))
(trait_item body: (declaration_list (function_signature_item name: (identifier) @name) @definition.method))
(function_item name: (identifier) @name) @definition.function
(macro_definition name: (identifier) @name) @definition.function
(struct_item name: (type_identifier) @name) @definition.class
(enum_item name: (type_identifier) @name) @definition.type
(union_item name: (type_identifier) @name) @definition.type
(trait_item name: (type_identifier) @name) @definition.type
(type_item name: (type_identifier) @name) @definition.type
(const_item name: (identifier) @name) @definition.variable
(static_item name: (identifier) @name) @definition.variable

; References. Earlier patterns win, so a struct built by a literal is used, not just named.

(call_expression function: (identifier) @reference.name)
(call_expression function: (scoped_identifier name: (identifier) @reference.member))
(struct_expression name: (type_identifier) @reference.name)
(field_expression value: (identifier) @reference.name)
(field_expression field: (field_identifier) @reference.member)
(macro_invocation macro: (identifier) @reference.name)
(type_identifier) @reference.type
