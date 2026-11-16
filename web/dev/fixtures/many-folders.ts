import type { AnalysisView } from "../../../contracts/index.ts";
import { syntheticAnalysisView } from "./large.ts";

// PRs whose files sit in many directories, in the path shapes of real repositories, for the file
// tree beside the code.

/** A Java service: the package path under src/main/java, mirrored under src/test/java. */
export const JAVA_SERVICE_PATHS: readonly string[] = [
  "pom.xml",
  "src/main/java/com/acmecorp/fulfillment/orders/OrdersApplication.java",
  "src/main/java/com/acmecorp/fulfillment/orders/config/RabbitMqConfiguration.java",
  "src/main/java/com/acmecorp/fulfillment/orders/config/SecurityConfiguration.java",
  "src/main/java/com/acmecorp/fulfillment/orders/controllers/OrdersController.java",
  "src/main/java/com/acmecorp/fulfillment/orders/controllers/advice/GlobalExceptionHandler.java",
  "src/main/java/com/acmecorp/fulfillment/orders/entities/CustomerOrder.java",
  "src/main/java/com/acmecorp/fulfillment/orders/entities/OrderLineItem.java",
  "src/main/java/com/acmecorp/fulfillment/orders/entities/ShippingAddress.java",
  "src/main/java/com/acmecorp/fulfillment/orders/repositories/CustomerOrderRepository.java",
  "src/main/java/com/acmecorp/fulfillment/orders/resources/NewOrderResource.java",
  "src/main/java/com/acmecorp/fulfillment/orders/services/AsyncGetService.java",
  "src/main/java/com/acmecorp/fulfillment/orders/services/payment/PaymentAuthorizationResponse.java",
  "src/main/java/com/acmecorp/fulfillment/orders/services/payment/PaymentAuthorizationService.java",
  "src/main/java/com/acmecorp/fulfillment/orders/services/shipping/ShippingQuoteClient.java",
  "src/main/java/com/acmecorp/fulfillment/orders/values/PaymentRequest.java",
  "src/main/java/com/acmecorp/fulfillment/orders/values/PaymentResponse.java",
  "src/main/resources/application.properties",
  "src/main/resources/db/migration/V7__add_order_line_items.sql",
  "src/test/java/com/acmecorp/fulfillment/orders/controllers/OrdersControllerTest.java",
  "src/test/java/com/acmecorp/fulfillment/orders/entities/CustomerOrderTest.java",
  "src/test/java/com/acmecorp/fulfillment/orders/services/payment/PaymentAuthorizationServiceTest.java",
  "src/test/java/com/acmecorp/fulfillment/orders/services/shipping/ShippingQuoteClientTest.java",
  "src/test/resources/fixtures/payment-authorized.json",
];

/** A monorepo: a dozen packages, a file or two each. */
export const MONOREPO_PATHS: readonly string[] = [
  ".changeset/brave-lions-sing.md",
  "apps/admin-dashboard/src/pages/settings/BillingSettingsPage.tsx",
  "apps/storefront/src/components/checkout/PaymentMethodSelector.tsx",
  "apps/storefront/src/hooks/useCheckoutSession.ts",
  "packages/analytics-client/src/track.ts",
  "packages/api-client/src/generated/models/PaymentIntent.ts",
  "packages/api-client/src/generated/services/PaymentsService.ts",
  "packages/auth-js/src/GoTrueClient.ts",
  "packages/auth-js/src/lib/fetch.ts",
  "packages/config-eslint/index.js",
  "packages/design-tokens/src/colors.ts",
  "packages/feature-flags/src/flags.ts",
  "packages/i18n/locales/de-DE/checkout.json",
  "packages/i18n/locales/en-US/checkout.json",
  "packages/logger/src/index.ts",
  "packages/payments-core/src/intents/createPaymentIntent.test.ts",
  "packages/payments-core/src/intents/createPaymentIntent.ts",
  "packages/supabase-js/src/SupabaseClient.ts",
  "packages/supabase-js/src/lib/helpers.ts",
  "packages/ui-kit/src/components/Button/Button.stories.tsx",
  "packages/ui-kit/src/components/Button/Button.tsx",
  "pnpm-lock.yaml",
  "services/payments-gateway/src/handlers/webhook.ts",
];

/** A web app nested deep, with many sibling directories at each level. */
export const DEEP_APP_PATHS: readonly string[] = [
  "web/src/features/accounts/components/profile/avatar/AvatarUploader.tsx",
  "web/src/features/accounts/components/profile/ProfileForm.tsx",
  "web/src/features/accounts/components/security/TwoFactorSetup.tsx",
  "web/src/features/accounts/hooks/useProfile.ts",
  "web/src/features/billing/api/invoices.ts",
  "web/src/features/billing/api/payment-methods.ts",
  "web/src/features/billing/components/invoices/filters/DateRangeFilter.tsx",
  "web/src/features/billing/components/invoices/filters/StatusFilter.tsx",
  "web/src/features/billing/components/invoices/InvoiceRow.tsx",
  "web/src/features/billing/components/invoices/InvoiceTable.tsx",
  "web/src/features/billing/components/payment-methods/AddCardDialog.tsx",
  "web/src/features/billing/components/payment-methods/CardList.tsx",
  "web/src/features/billing/hooks/useInvoices.ts",
  "web/src/features/notifications/components/NotificationBell.tsx",
  "web/src/features/notifications/components/preferences/ChannelToggle.tsx",
  "web/src/features/notifications/state/notificationsSlice.ts",
  "web/src/features/reports/components/charts/legend/ChartLegend.tsx",
  "web/src/features/reports/components/charts/RevenueChart.tsx",
  "web/src/features/reports/utils/aggregate.ts",
  "web/src/shared/components/forms/inputs/CurrencyInput.tsx",
  "web/src/shared/components/layout/sidebar/SidebarItem.tsx",
  "web/src/shared/components/layout/sidebar/SidebarNav.tsx",
  "web/src/shared/lib/format/money.ts",
  "web/src/shared/lib/http/client.ts",
  "web/src/shared/lib/http/interceptors/auth.ts",
  "web/tests/e2e/accounts/two-factor.spec.ts",
  "web/tests/e2e/billing/invoices.spec.ts",
];

export const javaServiceAnalysisView: AnalysisView = syntheticAnalysisView({
  number: 901,
  title: "Authorize payment before accepting an order",
  description: "Orders now call the payment service before they're saved.",
  paths: JAVA_SERVICE_PATHS,
  hunksPerFile: 1,
});

export const monorepoAnalysisView: AnalysisView = syntheticAnalysisView({
  number: 902,
  title: "Move payment intents into payments-core",
  description: "Every package that created a payment intent now calls payments-core.",
  paths: MONOREPO_PATHS,
  hunksPerFile: 1,
});

export const deepAppAnalysisView: AnalysisView = syntheticAnalysisView({
  number: 903,
  title: "Show money in the account's currency everywhere",
  description: "Billing, reports and the profile format amounts with the shared money helper.",
  paths: DEEP_APP_PATHS,
  hunksPerFile: 1,
});
