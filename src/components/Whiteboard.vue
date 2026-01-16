<template>
  <div class="whiteboard-container">
    <canvas
      ref="canvasRef"
      class="whiteboard-canvas"
    ></canvas>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, inject, computed, type Ref } from 'vue'
import { fabric } from 'fabric'
import { useLiveStore } from '@/store/liveStore'
import type { SignalService } from '@/utils/signal'

const store = useLiveStore()

// 从父组件注入 signalService（教师端和学生端都有）
const signalServiceRef = inject<Ref<SignalService | null>>('signalService', ref(null))
const signalService = computed(() => signalServiceRef.value)

// 通过 props 传递 isTeacher，如果没有传递则默认为 false（学生端）
interface Props {
  isTeacher?: boolean
}
const props = withDefaults(defineProps<Props>(), {
  isTeacher: false
})

const isTeacher = computed(() => props.isTeacher)

// 是否正在同步（防止循环同步）
let isSyncing = false

const canvasRef = ref<HTMLCanvasElement | null>(null)
let canvas: fabric.Canvas | null = null
let isDrawing = false
let currentTool = 'pen'
let startPoint: fabric.Point | null = null
let currentShape: fabric.Object | null = null
let isCreatingText = false // 防止重复创建文字

// 窗口大小变化处理函数
let handleResize: (() => void) | null = null

onMounted(() => {
  // 等待DOM完全渲染后再初始化画布
  setTimeout(() => {
    if (canvasRef.value) {
      const container = canvasRef.value.parentElement
      const width = container ? container.offsetWidth : canvasRef.value.offsetWidth || 800
      const height = container ? container.offsetHeight : canvasRef.value.offsetHeight || 600
      
      console.log('[Whiteboard] 初始化画布，尺寸:', { width, height })
      
      canvas = new fabric.Canvas(canvasRef.value, {
        width: width,
        height: height,
        backgroundColor: '#ffffff'
      })

      // 根据是否是教师端设置不同的模式
      if (isTeacher.value) {
        // 教师端：允许绘制
        canvas.freeDrawingBrush.width = 3
        canvas.freeDrawingBrush.color = '#000000'
        canvas.isDrawingMode = true
        canvas.selection = false
        canvas.defaultCursor = 'crosshair'
      } else {
        // 学生端：只读模式，禁用所有绘制和交互
        canvas.isDrawingMode = false
        canvas.selection = false
        canvas.defaultCursor = 'default'
        // 禁用自由绘制画笔
        canvas.freeDrawingBrush.width = 0
        canvas.freeDrawingBrush.color = 'transparent' // 设置为透明
        // 完全禁用画布交互
        canvas.allowTouchScrolling = false
        canvas.skipTargetFind = true // 跳过目标查找，禁用所有交互
        canvas.stopContextMenu = true // 禁用右键菜单
        // 禁用所有对象的选择和交互
        canvas.forEachObject((obj) => {
          obj.selectable = false
          obj.evented = false
        })
        // 禁用画布的所有交互功能
        canvas.hoverCursor = 'default'
        canvas.moveCursor = 'default'
        // 移除所有 Fabric.js 事件监听器
        canvas.off('mouse:down')
        canvas.off('mouse:move')
        canvas.off('mouse:up')
        canvas.off('mouse:over')
        canvas.off('mouse:out')
        canvas.off('path:created')
        canvas.off('object:added')
        canvas.off('object:modified')
        canvas.off('object:removed')
        canvas.off('mouse:wheel')
        canvas.off('mouse:dblclick')
        // 禁用 Fabric.js 的所有绘制相关功能
        canvas.on('path:created', () => {
          // 阻止学生端创建任何路径
          console.warn('[Whiteboard] ⚠️ 学生端：检测到路径创建尝试，已阻止')
        })
        // 阻止所有鼠标事件
        const preventAllEvents = (e: Event) => {
          e.preventDefault()
          e.stopPropagation()
          e.stopImmediatePropagation()
          return false
        }
        if (canvasRef.value) {
          // 使用 capture 阶段捕获所有事件，确保在 Fabric.js 之前拦截
          canvasRef.value.addEventListener('mousedown', preventAllEvents, true)
          canvasRef.value.addEventListener('mousemove', preventAllEvents, true)
          canvasRef.value.addEventListener('mouseup', preventAllEvents, true)
          canvasRef.value.addEventListener('click', preventAllEvents, true)
          canvasRef.value.addEventListener('dblclick', preventAllEvents, true)
          canvasRef.value.addEventListener('contextmenu', preventAllEvents, true)
          canvasRef.value.addEventListener('touchstart', preventAllEvents, true)
          canvasRef.value.addEventListener('touchmove', preventAllEvents, true)
          canvasRef.value.addEventListener('touchend', preventAllEvents, true)
          canvasRef.value.addEventListener('wheel', preventAllEvents, true)
          // 完全禁用指针事件，但保留显示功能
          // 注意：pointerEvents: 'none' 会阻止所有交互，包括我们添加的事件监听器
          // 所以我们需要在事件监听器中处理，而不是完全禁用 pointerEvents
          canvasRef.value.style.userSelect = 'none' // 禁用文本选择
          canvasRef.value.style.touchAction = 'none' // 禁用触摸操作
          canvasRef.value.style.cursor = 'default' // 设置默认光标
        }
        console.log('[Whiteboard] 学生端模式：已禁用所有绘制和交互功能')
      }

      // 使用 Fabric.js 的事件系统
      setupCanvasEvents()
      
      // 延迟设置同步事件，确保 signalService 已注入
      setTimeout(() => {
        if (isTeacher.value && signalService.value) {
          setupSyncEvents()
          console.log('[Whiteboard] 已设置白板同步事件（教师端）')
        } else {
          console.log('[Whiteboard] 学生端模式，不设置同步事件')
        }
      }, 100)

      store.whiteboardCanvas = canvasRef.value
      
      // 监听窗口大小变化，调整画布尺寸
      handleResize = () => {
        if (canvas && canvasRef.value) {
          const container = canvasRef.value.parentElement
          if (container) {
            const newWidth = container.offsetWidth
            const newHeight = container.offsetHeight
            canvas.setDimensions({ width: newWidth, height: newHeight })
            canvas.renderAll()
            console.log('[Whiteboard] 画布尺寸已更新:', { width: newWidth, height: newHeight })
          }
        }
      }
      
      window.addEventListener('resize', handleResize)
    } else {
      console.error('[Whiteboard] ❌ canvasRef 为空，无法初始化画布')
    }
  }, 100)
})

onUnmounted(() => {
  // 移除窗口大小变化监听器
  if (handleResize) {
    window.removeEventListener('resize', handleResize)
    handleResize = null
  }
  
  // 清理画布
  if (canvas) {
    canvas.dispose()
    canvas = null
  }
})

function setupCanvasEvents() {
  if (!canvas) return

  // 学生端完全禁用所有鼠标事件，不注册任何绘制相关的事件监听器
  if (!isTeacher.value) {
    console.log('[Whiteboard] 学生端：已禁用所有鼠标事件监听器')
    return
  }

  // 教师端：注册鼠标事件
  // 鼠标按下事件
  canvas.on('mouse:down', (options: fabric.IEvent) => {
    handleMouseDown(options)
  })

  // 鼠标移动事件
  canvas.on('mouse:move', (options: fabric.IEvent) => {
    handleMouseMove(options)
  })

  // 鼠标抬起事件
  canvas.on('mouse:up', (options: fabric.IEvent) => {
    handleMouseUp(options)
  })
}

// 设置同步事件（仅教师端）
function setupSyncEvents() {
  if (!canvas || !isTeacher.value) return
  
  // 监听路径创建（画笔绘制）
  canvas.on('path:created', (e: fabric.IEvent) => {
    if (isSyncing) return
    const path = e.path
    if (path && signalService.value) {
      // 为路径添加唯一ID
      if (!(path as any).id) {
        (path as any).id = `path_${Date.now()}_${Math.random()}`
      }
      // 确保路径对象包含所有必要属性
      const pathData = path.toJSON(['id']) // 包含自定义属性 id
      console.log('[Whiteboard] 发送画笔绘制:', {
        id: pathData.id,
        type: pathData.type,
        hasPath: !!pathData.path,
        pathLength: pathData.path ? pathData.path.length : 0
      })
      signalService.value.whiteboardDraw('path:created', pathData)
    }
  })
  
  // 监听对象添加（图形、文字等）
  canvas.on('object:added', (e: fabric.IEvent) => {
    if (isSyncing) return
    const obj = e.target
    if (obj && signalService.value) {
      // 确保对象有唯一ID
      if (!(obj as any).id) {
        (obj as any).id = `${obj.type}_${Date.now()}_${Math.random()}`
      }
      
      // 对于图形（line, rect, circle），不在 object:added 时发送
      // 而是在 handleMouseUp 时发送最终状态，确保大小正确
      if (obj.type === 'line' || obj.type === 'rect' || obj.type === 'circle') {
        // 不发送，等待 handleMouseUp 时发送
        console.log('[Whiteboard] 图形已添加，等待鼠标放开后发送:', obj.type, (obj as any).id)
      } else if (obj.type === 'i-text' || obj.type === 'text') {
        // 文字对象：在创建时发送初始状态（空文字），编辑完成后会再次发送最终状态
        const objData = obj.toJSON(['id']) // 包含自定义属性 id
        signalService.value.whiteboardDraw('object:added', objData)
        console.log('[Whiteboard] 发送文字初始添加:', obj.type, objData.id, 'text:', objData.text)
      } else {
        // 其他对象立即发送
        const objData = obj.toJSON(['id']) // 包含自定义属性 id
        signalService.value.whiteboardDraw('object:added', objData)
        console.log('[Whiteboard] 发送对象添加:', obj.type, objData.id)
      }
    }
  })
  
  // 监听对象修改（移动、缩放等）
  canvas.on('object:modified', (e: fabric.IEvent) => {
    if (isSyncing) return
    const obj = e.target
    if (obj && signalService.value) {
      // 对于文字对象，修改时也同步（比如移动位置）
      const objData = obj.toJSON(['id']) // 包含自定义属性 id
      signalService.value.whiteboardDraw('object:modified', objData)
      console.log('[Whiteboard] 发送对象修改:', obj.type, objData.id)
    }
  })
  
}

onUnmounted(() => {
  if (canvas) {
    // 移除所有事件监听器
    canvas.off('mouse:down')
    canvas.off('mouse:move')
    canvas.off('mouse:up')
    canvas.dispose()
    canvas = null
  }
})

watch(() => store.whiteboardEnabled, (enabled) => {
  if (canvas) {
    // 学生端始终禁用绘制
    if (!isTeacher.value) {
      canvas.isDrawingMode = false
      canvas.defaultCursor = 'default'
      canvas.freeDrawingBrush.width = 0
      canvas.freeDrawingBrush.color = 'transparent'
      canvas.skipTargetFind = true
      // 再次确保所有对象不可交互
      canvas.forEachObject((obj) => {
        obj.selectable = false
        obj.evented = false
      })
      console.log('[Whiteboard] 学生端：watch 中已禁用所有绘制功能')
      return
    }
    // 教师端根据状态和工具设置
    canvas.isDrawingMode = enabled && currentTool === 'pen'
    if (!enabled) {
      canvas.defaultCursor = 'default'
    } else {
      canvas.defaultCursor = 'crosshair'
    }
  }
})

const emit = defineEmits<{
  toolChanged: [tool: string]
  clear: []
}>()

function handleMouseDown(options: fabric.IEvent) {
  if (!canvas) return
  
  // 学生端禁用所有绘制操作（双重检查）
  if (!isTeacher.value) {
    console.warn('[Whiteboard] ⚠️ 学生端：尝试绘制但已被禁用，阻止操作')
    options.e.preventDefault()
    options.e.stopPropagation()
    options.e.stopImmediatePropagation()
    return
  }
  
  const pointer = canvas.getPointer(options.e)
  startPoint = new fabric.Point(pointer.x, pointer.y)
  isDrawing = true

  // 阻止默认行为（选择对象）
  if (currentTool !== 'text' && currentTool !== 'pen') {
    options.e.preventDefault()
    options.e.stopPropagation()
  }

  switch (currentTool) {
    case 'line':
      currentShape = new fabric.Line(
        [pointer.x, pointer.y, pointer.x, pointer.y],
        {
          stroke: '#000000',
          strokeWidth: 2,
          selectable: false,
        evented: true,
        id: `line_${Date.now()}_${Math.random()}` // 添加唯一ID用于同步
        }
      )
      canvas.add(currentShape)
      canvas.renderAll()
      break
    
    case 'rect':
      currentShape = new fabric.Rect({
        left: pointer.x,
        top: pointer.y,
        width: 0,
        height: 0,
        fill: 'transparent',
        stroke: '#000000',
        strokeWidth: 2,
        selectable: false,
        evented: true,
        id: `rect_${Date.now()}_${Math.random()}` // 添加唯一ID用于同步
      })
      canvas.add(currentShape)
      canvas.renderAll()
      break
    
    case 'circle':
      currentShape = new fabric.Circle({
        left: pointer.x,
        top: pointer.y,
        radius: 0,
        fill: 'transparent',
        stroke: '#000000',
        strokeWidth: 2,
        selectable: false,
        evented: true,
        id: `circle_${Date.now()}_${Math.random()}` // 添加唯一ID用于同步
      })
      canvas.add(currentShape)
      canvas.renderAll()
      break
    
    
    case 'text':
      // 防止重复创建文字框
      if (isCreatingText) {
        return
      }
      
      // 如果点击的是已有文字对象，不创建新文字
      if (options.target && options.target.type === 'i-text') {
        return
      }
      
      isCreatingText = true
      const text = new fabric.IText('', {
        left: pointer.x,
        top: pointer.y,
        fontSize: 20,
        fill: '#000000',
        selectable: true,
        id: `text_${Date.now()}_${Math.random()}` // 添加唯一ID用于同步
      })
      canvas.add(text)
      canvas.setActiveObject(text)
      
      // 延迟进入编辑模式，确保对象已添加到画布
      setTimeout(() => {
        if (text && canvas) {
          text.enterEditing()
          // 监听编辑完成事件，重置标志并发送最终状态
          text.on('editing:exited', () => {
            isCreatingText = false
            // 教师端：在文字编辑完成时发送最终状态
            if (isTeacher.value && signalService.value && !isSyncing) {
              // 确保对象有唯一ID
              if (!(text as any).id) {
                (text as any).id = `text_${Date.now()}_${Math.random()}`
              }
              const textData = text.toJSON(['id']) // 包含自定义属性 id
              signalService.value.whiteboardDraw('object:added', textData)
              console.log('[Whiteboard] ✅ 发送文字完成（编辑退出）:', {
                id: textData.id,
                text: textData.text,
                left: textData.left,
                top: textData.top
              })
            }
          })
        }
      }, 10)
      break
  }
}

function handleMouseMove(options: fabric.IEvent) {
  if (!canvas || !isDrawing) return
  
  // 学生端禁用所有绘制操作（双重检查）
  if (!isTeacher.value) {
    options.e.preventDefault()
    options.e.stopPropagation()
    isDrawing = false
    return
  }

  const pointer = canvas.getPointer(options.e)

  switch (currentTool) {
    case 'line':
      if (currentShape && startPoint) {
        const line = currentShape as fabric.Line
        line.set({
          x2: pointer.x,
          y2: pointer.y
        })
        canvas.renderAll()
      }
      break
    
    case 'rect':
      if (currentShape && startPoint) {
        const rect = currentShape as fabric.Rect
        const width = Math.abs(pointer.x - startPoint.x)
        const height = Math.abs(pointer.y - startPoint.y)
        rect.set({
          width: width,
          height: height,
          left: Math.min(pointer.x, startPoint.x),
          top: Math.min(pointer.y, startPoint.y)
        })
        canvas.renderAll()
      }
      break
    
    case 'circle':
      if (currentShape && startPoint) {
        const circle = currentShape as fabric.Circle
        const radius = Math.sqrt(
          Math.pow(pointer.x - startPoint.x, 2) + 
          Math.pow(pointer.y - startPoint.y, 2)
        ) / 2
        circle.set({
          radius: radius,
          left: startPoint.x - radius,
          top: startPoint.y - radius
        })
        canvas.renderAll()
      }
      break
    
  }
}

function handleMouseUp(options: fabric.IEvent) {
  if (!canvas) return
  
  // 学生端禁用所有绘制操作
  if (!isTeacher.value) {
    return
  }
  
  if (isDrawing) {
    isDrawing = false
  }
  
  // 完成绘制后，让图形可选择（如果需要）
  if (currentShape) {
    currentShape.set({
      selectable: true,
      evented: true
    })
    
    // 教师端：在鼠标放开时发送图形的最终状态，确保大小正确
    // 对于图形（line, rect, circle），只在 handleMouseUp 时发送，不在 object:added 时发送
    if (isTeacher.value && signalService.value && !isSyncing) {
      // 确保对象有唯一ID
      if (!(currentShape as any).id) {
        (currentShape as any).id = `${currentShape.type}_${Date.now()}_${Math.random()}`
      }
      
      // 对于图形，发送最终状态
      if (currentShape.type === 'line' || currentShape.type === 'rect' || currentShape.type === 'circle') {
        const finalData = currentShape.toJSON(['id']) // 包含自定义属性 id
        signalService.value.whiteboardDraw('object:added', finalData)
        console.log('[Whiteboard] ✅ 发送图形完成（鼠标放开）:', currentShape.type, {
          id: finalData.id,
          left: finalData.left,
          top: finalData.top,
          width: finalData.width || finalData.radius || 0,
          height: finalData.height || finalData.radius || 0
        })
      }
    }
  }
  
  // 文字工具：如果点击空白区域且没有创建文字，重置标志
  if (currentTool === 'text' && !options.target) {
    // 延迟重置，确保文字创建流程完成
    setTimeout(() => {
      if (!canvas?.getActiveObject()) {
        isCreatingText = false
      }
    }, 100)
  }
  
  startPoint = null
  currentShape = null
  canvas.renderAll()
}

function setTool(tool: string) {
  if (!canvas) return
  
  // 学生端禁用工具切换
  if (!isTeacher.value) {
    console.log('[Whiteboard] 学生端：工具切换已禁用')
    return
  }

  currentTool = tool
  canvas.isDrawingMode = tool === 'pen'
  canvas.selection = tool === 'text' // 只有文字工具允许选择

  // 清除当前选中的对象（除了文字）
  if (tool !== 'text') {
    canvas.discardActiveObject()
    canvas.renderAll()
  }

  // 切换工具时重置文字创建标志
  if (tool !== 'text') {
    isCreatingText = false
  }

  switch (tool) {
    case 'pen':
      canvas.freeDrawingBrush.width = 3
      canvas.freeDrawingBrush.color = '#000000'
      canvas.defaultCursor = 'crosshair'
      break
    
    case 'line':
    case 'rect':
    case 'circle':
      canvas.defaultCursor = 'crosshair'
      break
    
    case 'text':
      canvas.defaultCursor = 'text'
      break
  }

  emit('toolChanged', tool)
}

function clear() {
  if (!canvas) return
  
  // 学生端可以接收清除事件并清空白板，但不能主动触发清除
  // 如果是学生端且没有 signalService，说明是主动触发，应该阻止
  // 如果是学生端且有 signalService，说明是接收清除事件，应该允许
  if (!isTeacher.value && !signalService.value) {
    console.log('[Whiteboard] 学生端：不能主动清空白板')
    return
  }
  
  isSyncing = true
  canvas.clear()
  canvas.backgroundColor = '#ffffff'
  isSyncing = false
  emit('clear')
  
  // 只有教师端才发送清除事件
  if (isTeacher.value && signalService.value) {
    signalService.value.whiteboardClear()
    console.log('[Whiteboard] ✅ 教师端已发送清除事件')
  } else {
    console.log('[Whiteboard] ✅ 学生端已接收清除事件并清空白板')
  }
}

// 应用远程绘制操作（学生端使用）
function applyRemoteDraw(action: string, data: any) {
  if (!canvas) {
    console.warn('[Whiteboard] Canvas 未初始化，无法应用远程绘制')
    return
  }
  
  if (isTeacher.value) {
    console.warn('[Whiteboard] ⚠️ 教师端不应接收远程绘制，跳过')
    return
  }
  
  console.log('[Whiteboard] 应用远程绘制:', action, {
    type: data.type,
    id: data.id,
    hasPath: !!data.path,
    keys: Object.keys(data),
    canvasReady: !!canvas,
    isTeacher: isTeacher.value
  })
  
  if (!canvas) {
    console.error('[Whiteboard] ❌ Canvas 未初始化，无法应用远程绘制')
    return
  }
  
  isSyncing = true
  
  // 使用 Promise 确保异步操作完成
  const applyOperation = async () => {
    try {
      switch (action) {
        case 'path:created':
          console.log('[Whiteboard] 恢复画笔路径:', data.id || '无ID', 'type:', data.type)
          return new Promise<void>((resolve, reject) => {
            try {
              console.log('[Whiteboard] 🔄 开始调用 enlivenObjects 恢复路径对象...')
              // 路径对象需要使用 enlivenObjects 恢复
              fabric.util.enlivenObjects([data], (objects: fabric.Object[]) => {
                console.log('[Whiteboard] 📥 enlivenObjects 回调执行，返回对象数:', objects?.length || 0)
                
                if (!objects || objects.length === 0) {
                  console.warn('[Whiteboard] ⚠️ enlivenObjects 返回空数组，尝试直接创建路径')
                  // 如果 enlivenObjects 失败，尝试直接创建路径
                  try {
                    if (!data.path) {
                      console.error('[Whiteboard] ❌ 数据中没有 path 字段，无法创建路径')
                      reject(new Error('数据中没有 path 字段'))
                      return
                    }
                    const path = new fabric.Path(data.path, {
                      left: data.left || 0,
                      top: data.top || 0,
                      stroke: data.stroke || '#000000',
                      strokeWidth: data.strokeWidth || 3,
                      fill: data.fill || '',
                      id: data.id,
                      selectable: false,
                      evented: false,
                      excludeFromExport: false
                    })
                    if (data.id) {
                      (path as any).id = data.id
                    }
                    canvas.add(path)
                    canvas.renderAll()
                    console.log('[Whiteboard] ✅ 路径已通过直接创建添加，对象数:', canvas.getObjects().length)
                    resolve()
                  } catch (createError) {
                    console.error('[Whiteboard] ❌ 直接创建路径也失败:', createError)
                    reject(createError)
                  }
                  return
                }
                
                console.log('[Whiteboard] ✅ enlivenObjects 成功恢复', objects.length, '个对象')
                
                objects.forEach((obj, index) => {
                  // 确保对象有唯一ID
                  if (!(obj as any).id && data.id) {
                    (obj as any).id = data.id
                  }
                  // 确保对象可见且可渲染，学生端禁用交互
                  obj.set({
                    visible: true,
                    opacity: 1,
                    selectable: false,
                    evented: false, // 学生端禁用所有交互
                    excludeFromExport: false // 确保对象会被渲染
                  })
                  
                  // 添加到画布
                  canvas.add(obj)
                  
                  console.log(`[Whiteboard] 路径对象 ${index + 1}/${objects.length} 已添加到画布:`, {
                    type: obj.type,
                    id: (obj as any).id,
                    visible: obj.visible,
                    opacity: obj.opacity,
                    left: obj.left,
                    top: obj.top,
                    width: (obj as any).width,
                    height: (obj as any).height,
                    canvasObjectsCount: canvas.getObjects().length
                  })
                })
                
                // 立即渲染
                canvas.renderAll()
                const currentObjectsCount = canvas.getObjects().length
                console.log('[Whiteboard] ✅ 已立即渲染画布，对象数:', currentObjectsCount)
                
                // 延迟验证，确保对象已渲染
                setTimeout(() => {
                  const allObjects = canvas.getObjects()
                  console.log('[Whiteboard] 延迟验证：当前画布对象数:', allObjects.length)
                  if (data.id) {
                    const addedObj = allObjects.find((o: any) => (o as any).id === data.id)
                    if (addedObj) {
                      console.log('[Whiteboard] ✅ 验证：路径对象已在画布上，类型:', addedObj.type, 'ID:', data.id)
                    } else {
                      console.error('[Whiteboard] ❌ 验证失败：路径对象未在画布上，ID:', data.id)
                      console.error('[Whiteboard] 画布上的所有对象ID:', allObjects.map((o: any) => (o as any).id || '无ID'))
                    }
                  }
                }, 50)
                
                resolve()
              }, 'fabric')
            } catch (error) {
              console.error('[Whiteboard] 恢复路径失败:', error)
              console.error('[Whiteboard] 错误详情:', error)
              reject(error)
            }
          })
        
        case 'object:added':
          console.log('[Whiteboard] 恢复对象:', data.type, data.id || '无ID')
          // 检查对象是否已存在（通过ID）
          if (data.id) {
            const existing = canvas.getObjects().find((o: any) => o.id === data.id)
            if (existing) {
              console.log('[Whiteboard] 对象已存在，跳过添加:', data.id)
              return Promise.resolve()
            }
          }
          
          return new Promise<void>((resolve, reject) => {
            try {
              console.log('[Whiteboard] 🔄 开始调用 enlivenObjects 恢复对象...')
              console.log('[Whiteboard] 数据检查:', {
                hasData: !!data,
                type: data.type,
                hasId: !!data.id,
                dataKeys: Object.keys(data)
              })
              fabric.util.enlivenObjects([data], (objects: fabric.Object[]) => {
                console.log('[Whiteboard] 📥 enlivenObjects 回调执行，返回对象数:', objects?.length || 0)
                
                if (!objects || objects.length === 0) {
                  console.warn('[Whiteboard] ⚠️ enlivenObjects 返回空数组，尝试直接创建对象')
                  // 尝试根据类型直接创建对象
                  try {
                    let newObj: fabric.Object | null = null
                    if (data.type === 'line') {
                      // Line 对象使用 path 数组，格式为 [x1, y1, x2, y2]
                      const path = data.path || []
                      if (path.length >= 4) {
                        newObj = new fabric.Line(path, {
                          stroke: data.stroke || '#000000',
                          strokeWidth: data.strokeWidth || 2,
                          id: data.id,
                          selectable: false,
                          evented: false,
                          excludeFromExport: false
                        })
                      } else {
                        // 如果没有 path，尝试使用 x1, y1, x2, y2 或其他属性
                        newObj = new fabric.Line([
                          data.x1 || data.left || 0,
                          data.y1 || data.top || 0,
                          data.x2 || (data.left || 0) + (data.width || 0),
                          data.y2 || (data.top || 0) + (data.height || 0)
                        ], {
                          stroke: data.stroke || '#000000',
                          strokeWidth: data.strokeWidth || 2,
                          id: data.id,
                          selectable: false,
                          evented: false,
                          excludeFromExport: false
                        })
                      }
                    } else if (data.type === 'rect') {
                      newObj = new fabric.Rect({
                        left: data.left || 0,
                        top: data.top || 0,
                        width: data.width || 0,
                        height: data.height || 0,
                        fill: data.fill || 'transparent',
                        stroke: data.stroke || '#000000',
                        strokeWidth: data.strokeWidth || 2,
                        id: data.id,
                        selectable: false,
                        evented: false,
                        excludeFromExport: false
                      })
                    } else if (data.type === 'circle') {
                      newObj = new fabric.Circle({
                        left: data.left || 0,
                        top: data.top || 0,
                        radius: data.radius || 0,
                        fill: data.fill || 'transparent',
                        stroke: data.stroke || '#000000',
                        strokeWidth: data.strokeWidth || 2,
                        id: data.id,
                        selectable: false,
                        evented: false,
                        excludeFromExport: false
                      })
                    } else if (data.type === 'i-text' || data.type === 'text') {
                      // 文字对象
                      newObj = new fabric.IText(data.text || '', {
                        left: data.left || 0,
                        top: data.top || 0,
                        fontSize: data.fontSize || 20,
                        fill: data.fill || '#000000',
                        id: data.id,
                        selectable: false,
                        evented: false,
                        excludeFromExport: false
                      })
                    }
                    
                    if (newObj) {
                      if (data.id) {
                        (newObj as any).id = data.id
                      }
                      newObj.set({
                        visible: true,
                        opacity: 1,
                        selectable: false,
                        evented: false, // 学生端禁用所有交互
                        excludeFromExport: false // 确保对象会被渲染
                      })
                      canvas.add(newObj)
                      canvas.renderAll()
                      console.log('[Whiteboard] ✅ 对象已通过直接创建添加，对象数:', canvas.getObjects().length)
                      resolve()
                      return
                    }
                  } catch (createError) {
                    console.error('[Whiteboard] ❌ 直接创建对象也失败:', createError)
                  }
                  reject(new Error('无法恢复对象'))
                  return
                }
                
                console.log('[Whiteboard] ✅ enlivenObjects 成功恢复', objects.length, '个对象')
                
                objects.forEach((obj, index) => {
                  // 确保对象有唯一ID
                  if (!(obj as any).id && data.id) {
                    (obj as any).id = data.id
                  }
                  // 确保对象可见且可渲染，学生端禁用交互
                  obj.set({
                    visible: true,
                    opacity: 1,
                    selectable: false,
                    evented: false, // 学生端禁用所有交互
                    excludeFromExport: false // 确保对象会被渲染
                  })
                  
                  // 添加到画布
                  canvas.add(obj)
                  
                  console.log(`[Whiteboard] 对象 ${index + 1}/${objects.length} 已添加到画布:`, {
                    type: obj.type,
                    id: (obj as any).id,
                    visible: obj.visible,
                    opacity: obj.opacity,
                    left: obj.left,
                    top: obj.top,
                    width: (obj as any).width,
                    height: (obj as any).height,
                    canvasObjectsCount: canvas.getObjects().length
                  })
                })
                
                // 立即渲染
                canvas.renderAll()
                const currentObjectsCount = canvas.getObjects().length
                console.log('[Whiteboard] ✅ 已立即渲染画布，对象数:', currentObjectsCount)
                
                // 延迟验证，确保对象已渲染
                setTimeout(() => {
                  const allObjects = canvas.getObjects()
                  console.log('[Whiteboard] 延迟验证：当前画布对象数:', allObjects.length)
                  if (data.id) {
                    const addedObj = allObjects.find((o: any) => (o as any).id === data.id)
                    if (addedObj) {
                      console.log('[Whiteboard] ✅ 验证：对象已在画布上，类型:', addedObj.type, 'ID:', data.id)
                    } else {
                      console.error('[Whiteboard] ❌ 验证失败：对象未在画布上，ID:', data.id)
                      console.error('[Whiteboard] 画布上的所有对象ID:', allObjects.map((o: any) => (o as any).id || '无ID'))
                    }
                  }
                }, 50)
                
                resolve()
              }, 'fabric')
            } catch (error) {
              console.error('[Whiteboard] 恢复对象失败:', error)
              reject(error)
            }
          })
        
        case 'object:modified':
          console.log('[Whiteboard] 修改对象:', data.id || '无ID')
          if (data.id) {
            const existingObj = canvas.getObjects().find((o: any) => o.id === data.id)
            if (existingObj) {
              return new Promise<void>((resolve, reject) => {
                try {
                  fabric.util.enlivenObjects([data], (objects: fabric.Object[]) => {
                    if (objects.length === 0) {
                      console.warn('[Whiteboard] 无法恢复修改的对象')
                      reject(new Error('无法恢复修改的对象'))
                      return
                    }
                    const obj = objects[0]
                    if (obj) {
                      existingObj.set({
                        ...obj.toObject(),
                        selectable: false,
                        evented: false // 学生端禁用所有交互
                      })
                      canvas.renderAll()
                      console.log('[Whiteboard] ✅ 对象已修改')
                      resolve()
                    } else {
                      reject(new Error('对象恢复失败'))
                    }
                  })
                } catch (error) {
                  console.error('[Whiteboard] 恢复修改对象失败:', error)
                  reject(error)
                }
              })
            } else {
              console.warn('[Whiteboard] 找不到要修改的对象:', data.id)
              return Promise.resolve()
            }
          }
          return Promise.resolve()
        
        
        default:
          console.warn('[Whiteboard] 未知的绘制操作:', action)
          return Promise.resolve()
      }
    } catch (error) {
      console.error('[Whiteboard] ❌ 应用远程绘制失败:', error, action, data)
      return Promise.reject(error)
    }
  }
  
  // 执行操作并处理完成/错误
  applyOperation()
    .then(() => {
      isSyncing = false
      console.log('[Whiteboard] ✅ 远程绘制操作完成:', action)
      // 再次强制渲染，确保对象显示
      if (canvas) {
        // 延迟一下再渲染，确保对象已完全添加
        setTimeout(() => {
          canvas.renderAll()
          const allObjects = canvas.getObjects()
          console.log('[Whiteboard] ✅ 已强制重新渲染画布，对象数:', allObjects.length)
          // 验证对象是否真的在画布上
          if (data && data.id) {
            const foundObj = allObjects.find((o: any) => (o as any).id === data.id)
            if (foundObj) {
              console.log('[Whiteboard] ✅ 最终验证：对象已在画布上，类型:', foundObj.type, 'ID:', data.id)
            } else {
              console.error('[Whiteboard] ❌ 最终验证失败：对象未在画布上，ID:', data.id)
              console.error('[Whiteboard] 画布上的所有对象ID:', allObjects.map((o: any) => (o as any).id || '无ID'))
            }
          }
        }, 100)
      }
    })
    .catch((error) => {
      isSyncing = false
      console.error('[Whiteboard] ❌ 远程绘制操作失败:', error, action, data)
      console.error('[Whiteboard] 错误堆栈:', (error as Error).stack)
      // 即使失败也尝试渲染
      if (canvas) {
        canvas.renderAll()
      }
    })
}

// 获取整个画布状态（教师端使用）
function getCanvasState() {
  if (!canvas) return null
  
  try {
    const state = canvas.toJSON(['id']) // 包含自定义属性 id
    return {
      objects: state.objects || [],
      backgroundColor: state.backgroundColor || '#ffffff',
      width: state.width,
      height: state.height
    }
  } catch (error) {
    console.error('[Whiteboard] 获取画布状态失败:', error)
    return null
  }
}

// 设置整个画布状态（学生端使用）
function setCanvasState(canvasState: any) {
  if (!canvas) {
    console.warn('[Whiteboard] Canvas 未初始化，无法设置画布状态')
    return
  }
  
  if (isTeacher.value) {
    console.warn('[Whiteboard] 教师端不应接收画布状态同步')
    return
  }
  
  console.log('[Whiteboard] 设置画布状态:', {
    objectsCount: canvasState.objects?.length || 0,
    backgroundColor: canvasState.backgroundColor,
    width: canvasState.width,
    height: canvasState.height
  })
  
  isSyncing = true
  
  try {
    // 清空当前画布
    canvas.clear()
    
    // 设置背景色
    if (canvasState.backgroundColor) {
      canvas.backgroundColor = canvasState.backgroundColor
    }
    
    // 设置画布尺寸
    if (canvasState.width && canvasState.height) {
      canvas.setDimensions({ width: canvasState.width, height: canvasState.height })
    }
    
    // 恢复所有对象
    if (canvasState.objects && canvasState.objects.length > 0) {
      fabric.util.enlivenObjects(canvasState.objects, (objects: fabric.Object[]) => {
        objects.forEach(obj => {
          // 学生端禁用所有交互
          obj.set({
            selectable: false,
            evented: false,
            visible: true,
            opacity: 1
          })
          canvas.add(obj)
        })
        canvas.renderAll()
        console.log('[Whiteboard] ✅ 画布状态已恢复，对象数:', objects.length)
        isSyncing = false
      }, 'fabric')
    } else {
      canvas.renderAll()
      console.log('[Whiteboard] ✅ 画布状态已恢复（空画布）')
      isSyncing = false
    }
  } catch (error) {
    console.error('[Whiteboard] ❌ 设置画布状态失败:', error)
    isSyncing = false
  }
}

// 暴露方法供父组件调用
defineExpose({
  setTool,
  clear,
  applyRemoteDraw,
  getCanvasState,
  setCanvasState
})
</script>

<style scoped lang="scss">
.whiteboard-container {
  width: 100%;
  height: 100%;
  position: relative;
  background: #f5f5f5;

  .whiteboard-canvas {
    width: 100%;
    height: 100%;
    cursor: crosshair;
  }
}
</style>









