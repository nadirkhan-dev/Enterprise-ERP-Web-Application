import {version} from './package.json';
import CustomPreset from './app/presets/index.js';

export default defineNuxtConfig({
    compatibilityDate: '2025-07-15',
    devtools: {enabled: process.env.NODE_ENV === 'development'},

    nitro: {
        compressPublicAssets: true
    },

    vite: {
        server: {
            allowedHosts: true // or your exact ngrok domain
        },
        build: {
            cssCodeSplit: true
        }
    },

    runtimeConfig: {
        deployToken: process.env.NUXT_DEPLOY_TOKEN || '',
        directusUrl: process.env.DIRECTUS_URL || '',
        directusToken: process.env.NUXT_DIRECTUS_TOKEN || '',
        lookerBaseUrl: process.env.NUXT_LOOKER_BASE_URL || '',
        lookerClientId: process.env.NUXT_LOOKER_CLIENT_ID || '',
        lookerClientSecret: process.env.NUXT_LOOKER_CLIENT_SECRET || '',
        sapServiceLayerUrl: process.env.NUXT_SAP_SERVICE_LAYER_URL || '',
        sapCompanyDb: process.env.NUXT_SAP_COMPANY_DB || '',
        sapUsername: process.env.NUXT_SAP_USERNAME || '',
        sapPassword: process.env.NUXT_SAP_PASSWORD || '',
        sapAllowSelfSignedCert:
            process.env.NUXT_SAP_ALLOW_SELF_SIGNED_CERT || '',
        fedexApiKey: process.env.NUXT_FEDEX_API_KEY || '',
        fedexSecretKey: process.env.NUXT_FEDEX_SECRET_KEY || '',
        fedexShipperAccount: process.env.NUXT_FEDEX_SHIPPER_ACCOUNT || '',
        fedexAccount: process.env.NUXT_FEDEX_ACCOUNT || '',
        fedexBillToAccount: process.env.NUXT_FEDEX_BILL_TO_ACCOUNT || '',
        fedexEnv: process.env.NUXT_FEDEX_ENV || 'sandbox',
        upsClientId: process.env.NUXT_UPS_CLIENT_ID || '',
        upsClientSecret: process.env.NUXT_UPS_CLIENT_SECRET || '',
        upsShipperNumber: process.env.NUXT_UPS_SHIPPER_NUMBER || '',
        upsEnv: process.env.NUXT_UPS_ENV || 'test',
        squareAccessToken: process.env.NUXT_SQUARE_ACCESS_TOKEN || '',
        pdfDownloadServiceUrl: process.env.NUXT_PDF_DOWNLOAD_SERVICE_URL || '',
        pdfDownloadServiceUserName: process.env.NUXT_PDF_DOWNLOAD_SERVICE_USER_NAME || '',
        pdfDownloadServiceUserPass: process.env.NUXT_PDF_DOWNLOAD_SERVICE_USER_PASS || '',
        turnstileSecretKey: process.env.NUXT_TURNSTILE_SECRET_KEY || '',
        msFormResponsesUrl: process.env.NUXT_MS_FORM_RESPONSES_URL || '',
        // Service Master (SAP sync worker) — server-side WS client uses these to
        // watch a new partner's sync job and relay status to the browser via SSE.
        serviceMasterWsUrl: process.env.NUXT_SERVICEMASTER_WS_URL || '',
        serviceMasterApiKey: process.env.NUXT_SERVICEMASTER_API_KEY || '',
        cfAccessClientId: process.env.NUXT_CF_ACCESS_CLIENT_ID || '',
        cfAccessClientSecret: process.env.NUXT_CF_ACCESS_CLIENT_SECRET || '',
        public: {
            appVersion: version,
            directusUrl: '/directus',
            directusWebsocketUrl:
                process.env.NUXT_PUBLIC_DIRECTUS_WEBSOCKET_URL || '',
            // Where Directus points the "reset your password" email. MUST be set:
            // left empty, the app sends no reset_url and Directus falls back to its
            // own project_url — which is SupplyHub, not Connect.
            passwordResetUrl: process.env.NUXT_PUBLIC_PASSWORD_RESET_URL || '',
            squareAppId: process.env.NUXT_PUBLIC_SQUARE_APPLICATION_ID || '',
            squareLocationId:
                process.env.NUXT_PUBLIC_SQUARE_LOCATION_ID || '',
            turnstileSiteKey: process.env.NUXT_PUBLIC_TURNSTILE_SITE_KEY || ''
        }
    },

    routeRules: {
        '/directus/**': {
            proxy: `${process.env.DIRECTUS_URL}/**`
        }
    },

    css: [
        'primeicons/primeicons.css',
        'animate.css/animate.min.css',
        '~/assets/css/fonts.css',
        '~/assets/css/main.css'
    ],

    modules: [
        '@primevue/nuxt-module',
        '@pinia/nuxt',
        'pinia-plugin-persistedstate/nuxt'
    ],

    piniaPluginPersistedstate: {
        storage: 'localStorage'
    },
    hooks: {
        'pages:extend'(pages) {
            function pascalToKebab(str) {
                return str
                    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
                    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
                    .toLowerCase();
            }

            function transformPages(pageList) {
                for (const page of pageList) {
                    if (page.path === '/') {
                        continue;
                    }

                    const segments = page.path.split('/').map((segment) => {
                        if (!segment || segment.startsWith(':')) {
                            return segment;
                        }
                        // Handle inline dynamic params: "Supplier:id" → "supplier/:id"
                        const colonIndex = segment.indexOf(':');
                        if (colonIndex > 0) {
                            const staticPart = pascalToKebab(
                                segment.substring(0, colonIndex)
                            );
                            const dynamicPart = segment.substring(colonIndex);
                            return `${staticPart}/${dynamicPart}`;
                        }
                        return pascalToKebab(segment);
                    });

                    page.path = segments.join('/');

                    // Collapse Index.vue routes: /customers/index → /customers
                    if (page.path !== '/' && page.path.endsWith('/index')) {
                        page.path = page.path.slice(0, -6);
                    }

                    if (page.name) {
                        page.name = pascalToKebab(page.name);
                    }

                    if (page.children?.length) {
                        transformPages(page.children);
                    }
                }
            }

            transformPages(pages);
        }
    },

    imports: {
        presets: [
            {
                from: 'primevue/usetoast',
                imports: ['useToast']
            }
        ]
    },

    primevue: {
        autoImport: true,
        options: {
            theme: {
                preset: CustomPreset,
                options: {
                    darkModeSelector: false,
                    cssLayer: {
                        name: 'primevue'
                    }
                }
            },
            ripple: true,
            pt: {
                inputtext: { root: { autocomplete: 'off' } },
                textarea: { root: { autocomplete: 'off' } },
                inputmask: { root: { autocomplete: 'off' } },
                inputnumber: { pcInputText: { root: { autocomplete: 'off' } } },
                password: { pcInputText: { root: { autocomplete: 'off' } } },
                autocomplete: { pcInputText: { root: { autocomplete: 'off' } } },
                datepicker: { pcInputText: { root: { autocomplete: 'off' } } },
                inputotp: { pcInputText: { root: { autocomplete: 'off' } } }
            }
        }
    }
});
