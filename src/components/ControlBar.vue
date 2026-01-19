<template>
  <div class="control-bar">
    <div class="control-bar__left">
      <slot name="left">
        <div class="meta">
          <span class="course" :title="courseName">{{ courseName || '课堂' }}</span>
          <span class="divider">·</span>
          <span class="online">在线 {{ onlineCount }}</span>
        </div>
      </slot>
    </div>

    <div class="control-bar__center">
      <slot />
    </div>

    <div class="control-bar__right">
      <slot name="right" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useLiveStore } from '@/store/liveStore'

interface Props {
  courseName?: string
  onlineCount?: number
}

const props = defineProps<Props>()
const store = useLiveStore()

const courseName = computed(() => props.courseName ?? store.courseName)
const onlineCount = computed(() => props.onlineCount ?? store.onlineCount)
</script>

<style scoped lang="scss">
@import '@/styles/variables.scss';

.control-bar {
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);

  .control-bar__left,
  .control-bar__center,
  .control-bar__right {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .control-bar__center {
    flex: 1;
    justify-content: center;
  }

  .control-bar__left,
  .control-bar__right {
    flex: 0 0 auto;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    font-size: 13px;
    opacity: 0.95;
  }

  .course {
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }

  .divider {
    opacity: 0.6;
  }

  .online {
    opacity: 0.9;
  }
}
</style>
