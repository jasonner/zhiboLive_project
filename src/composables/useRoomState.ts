/**
 * UI 状态派生
 */
import { computed, watch, Ref } from 'vue'
import { useLiveStore } from '@/store/liveStore'

export function useRoomState() {
  const store = useLiveStore()

  // 派生状态
  const displayMode = computed(() => store.displayMode)
  const currentDocument = computed(() => store.currentDocument)
  const isLive = computed(() => store.isLive)
  const teacherStream = computed(() => store.teacherStream)
  const screenStream = computed(() => store.screenStream)

  // 监听状态变化
  function setupStateWatchers() {
    // 监听 displayMode 变化
    watch(() => store.displayMode, () => {
      // 显示模式变化时的处理逻辑（如果需要）
    }, { immediate: true })

    // 监听 screenStream 变化
    watch(() => store.screenStream, () => {
      // 屏幕流变化时的处理逻辑（如果需要）
    }, { immediate: true, deep: true })

    // 监听 currentDocument 变化
    watch(() => store.currentDocument, () => {
      // 文档变化时的处理逻辑（如果需要）
    }, { immediate: true })

    // 监听 teacherStream 变化，确保组件能响应
    watch(() => store.teacherStream, (newStream, oldStream) => {
      console.log('[useRoomState] store.teacherStream 变化:', {
        old: oldStream?.id,
        new: newStream?.id,
        hasVideo: newStream ? newStream.getVideoTracks().length > 0 : false,
        hasAudio: newStream ? newStream.getAudioTracks().length > 0 : false
      })
    }, { immediate: true, deep: true })

    // 监听 isLive 变化，用于调试
    watch(() => store.isLive, (newValue, oldValue) => {
      console.log('[useRoomState] ⚡ isLive 状态变化:', {
        old: oldValue,
        new: newValue,
        timestamp: new Date().toLocaleTimeString()
      })
      console.log('[useRoomState] ⚡ computed isLive 值:', isLive.value)
      console.log('[useRoomState] ⚡ store.isLive 值:', store.isLive)

      // 强制触发 UI 更新
      if (newValue !== oldValue) {
        console.log('[useRoomState] ✅ isLive 已从', oldValue, '变为', newValue, '，UI 应该更新')
      }
    }, { immediate: true, deep: true })

    // 也监听 computed isLive 的变化
    watch(isLive, (newValue, oldValue) => {
      console.log('[useRoomState] ⚡ computed isLive 变化:', {
        old: oldValue,
        new: newValue,
        timestamp: new Date().toLocaleTimeString()
      })
    }, { immediate: true })
  }

  return {
    displayMode,
    currentDocument,
    isLive,
    teacherStream,
    screenStream,
    setupStateWatchers
  }
}
