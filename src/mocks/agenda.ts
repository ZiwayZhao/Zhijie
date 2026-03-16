/**
 * Mock agenda data — exam configs, study tasks, and todos.
 * Initialized once via localStorage guard.
 */
import { addDays, format } from 'date-fns'
import type { ExamConfig, StudyItem, TodoItem } from '@/lib/agenda-engine'
import { saveExamConfigs, saveTodos, loadExamConfigs, loadTodos } from '@/lib/agenda-engine'

const MOCK_INIT_KEY = 'zhijie_mock_agenda_initialized'

function createMockExamConfigs(): ExamConfig[] {
  const today = new Date()
  return [
    {
      courseId: 'qm-lmu',
      courseName: '量子力学导论',
      examDate: format(addDays(today, 3), 'yyyy-MM-dd'),
    },
    {
      courseId: 'algo-tum',
      courseName: '算法与数据结构',
      examDate: format(addDays(today, 12), 'yyyy-MM-dd'),
    },
  ]
}

function createMockStudyItems(): StudyItem[] {
  return [
    {
      type: 'study',
      id: 'study-oc-module3',
      courseId: 'oc-tum',
      courseName: '有机化学',
      moduleName: '亲核取代反应',
      estimatedMin: 30,
      priority: 'medium',
      completed: false,
    },
    {
      type: 'study',
      id: 'study-dm-graph',
      courseId: 'dm-tum',
      courseName: '离散数学',
      moduleName: '图论基础复习',
      estimatedMin: 20,
      priority: 'low',
      completed: false,
    },
  ]
}

function createMockTodos(): TodoItem[] {
  return [
    {
      type: 'todo',
      id: 'todo-1',
      title: '整理量子力学笔记第三章',
      completed: false,
    },
    {
      type: 'todo',
      id: 'todo-2',
      title: '下载算法课习题集 PDF',
      completed: true,
    },
    {
      type: 'todo',
      id: 'todo-3',
      title: '预约答疑时间（周四下午）',
      completed: false,
    },
  ]
}

/** Mock study items are returned directly (not persisted separately) */
let _mockStudyItems: StudyItem[] | null = null

export function getMockStudyItems(): StudyItem[] {
  if (!_mockStudyItems) {
    _mockStudyItems = createMockStudyItems()
  }
  return _mockStudyItems
}

export function initMockAgenda(): void {
  if (localStorage.getItem(MOCK_INIT_KEY)) return

  saveExamConfigs(createMockExamConfigs())
  saveTodos(createMockTodos())

  localStorage.setItem(MOCK_INIT_KEY, '1')
}

/** Convenience: load all agenda source data */
export function loadMockAgendaData() {
  return {
    examConfigs: loadExamConfigs(),
    studyItems: getMockStudyItems(),
    todos: loadTodos(),
  }
}
