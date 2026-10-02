<script setup lang="ts">
useHead({
  htmlAttrs: { lang: 'en' },
  titleTemplate: (titleChunk) => (titleChunk ? `${titleChunk} ∞ CONNECT` : 'CONNECT'),
  meta: [
    { name: 'description', content: 'ERP platform for HVAC and manufacturing businesses — manage customers, inventory, estimates, and more.' },
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    { charset: 'utf-8' },
  ],
  link: [
    { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
    { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
    { rel: 'shortcut icon', type: 'image/x-icon', href: '/favicon.ico' },
    { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
    { rel: 'preload', href: '/fonts/TT_Norms_Pro_Regular.woff2', as: 'font', type: 'font/woff2', crossorigin: 'anonymous' },
    { rel: 'preload', href: '/fonts/TT_Norms_Pro_SemiBold.woff2', as: 'font', type: 'font/woff2', crossorigin: 'anonymous' },
    { rel: 'dns-prefetch', href: useRuntimeConfig().public.directusUrl },
    { rel: 'preconnect', href: useRuntimeConfig().public.directusUrl },
  ],
})
</script>

<template>
  <NuxtRouteAnnouncer />
  <NuxtLayout>
    <NuxtPage :transition="{ name: 'page', mode: 'out-in' }" />
  </NuxtLayout>
</template>
