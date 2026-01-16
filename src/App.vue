<template>
  <router-view />
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

onMounted(() => {
  console.log('App.vue 已挂载')
  console.log('当前路由:', router.currentRoute.value.path)
  
  // 监听路由错误
  router.onError((error) => {
    console.error('路由错误:', error)
  })
})
</script>

<style scoped>
</style>


