import { eapi, Match } from '@/api/easyTyper'
import { ActionTree, GetterTree, Module, MutationTree } from 'vuex'
import { ArticleState, Coding, KataState, QuickTypingState, SettingState, Word } from './types'
import { shuffleText, isNative, replaceTextSpace, shuffle, splitLongText, generateRandomLetters, generateRandomNumbers, generateLettersAndNumbers } from './util/common'
import { Edge, Graph, ShortestPath } from './util/Graph'
import { TrieNode } from './util/TrieTree'
import { symbolsRegs } from './util/constants'
import { Message } from 'element-ui'
import { wikiTypes } from '@/api/constant'

const alphaPattern = /[a-zA-Z0-9]/

/**
 * 处理标点顶屏
 * @param vertex 边
 * @param graph DAG图
 */
const mergeEdge = (vertex: Map<number, Edge<Word>>, graph: Graph<Word>, setting: SettingState): void => {
  const { selectiveText, fourthAutoSelect, punctuations } = setting
  for (const edge of vertex.values()) {
    if (!punctuations.has(edge.value.text) || selectiveText.indexOf(edge.value.text) >= 0) {
      continue
    }

    for (const prev of graph.vertices[edge.to].values()) {
      const { to } = prev
      const { text, type, codings } = prev.value
      const { code, fourthSingle, index } = codings[0]
      if (alphaPattern.test(text)) {
        continue
      }

      if ((code.length < 4 || !fourthAutoSelect || !fourthSingle) && index === 0) {
        const newCode = code + edge.value.codings[0].code
        const value = new Word(to, text + edge.value.text, type, true, '', [new Coding(0, newCode, -1)])
        const exist = vertex.get(to)
        const newLength = newCode.length
        if (!exist || exist.length > newLength) {
          graph.addEdge({ from: edge.from, to, length: newLength, value })
        }
      }
    }
  }
}

const codingsBeforeMaxIndex = (codings: Array<Coding>, maxIndex: number, phrase: boolean): Array<Coding> => {
  const matched = codings.filter(v => v.index < maxIndex)
  return phrase ? matched : (matched && matched.length > 0 ? matched : codings)
}

/**
 * 处理文章计算最佳码长
 * @param content 文章内容
 * @param codings 码表
 * @param setting 设置
 */
const parse = (content: string, codings: TrieNode, setting: SettingState, getSelectChar: Function): ShortestPath<Word> | null => {
  if (!codings) {
    return null
  }

  const { selective, selectiveText, maxIndex, fourthAutoSelect, fifthAutoSelect } = setting
  const max = maxIndex === 0 ? Infinity : maxIndex
  const graph = new Graph<Word>()
  const contentLength = content.length
  let node: TrieNode
  for (let i = 0; i < contentLength; i++) {
    node = codings
    // 找出以当前字开始的所有词语
    for (let j = i; j < contentLength; j++) {
      const sub = node.get(content[j])
      if (!sub) {
        break
      }

      if (sub.value) {
        const { text, codings } = sub.value
        const matched = codingsBeforeMaxIndex(codings, max, text.length > 1)
        if (!matched || matched.length < 1) {
          continue
        }

        const { index, code, fourthSingle } = matched[0]
        const next = j + 1
        const length = code.length
        let select = getSelectChar(index, length)
        // 全码首选
        const fullCodeFirst = index === 0 && length === 4
        if (fullCodeFirst) {
          // 无法适用四码唯一自动上屏: 未启用四码唯一自动上屏，或不是四码唯一
          const notAutoSelect4 = !fourthAutoSelect || !fourthSingle
          // 无法适用第五码首选上屏：未启用第五码时首选上屏，或已是最后一个字，或后面是选重符号
          const notAutoSelect5 = !fifthAutoSelect || next === contentLength || selectiveText.indexOf(content[next]) >= 0
          if (notAutoSelect4 && notAutoSelect5) {
            // 该字/词为4码首选，且无法使用四码唯一上屏，也无法使用第5码顶屏，需要手动上屏
            select = selective[0]
          }
        }

        const type = length === 1 && index === -1 ? 'pending' : `code${length}`
        const value = new Word(i, text, type, false, select, matched)
        graph.addEdge({ from: next, to: i, length: length + select.length, value })
      }
      node = sub
    }
  }

  // 补全缺失的边
  const vertices = graph.vertices
  // console.log(vertices)
  for (let i = 1; i <= contentLength; i++) {
    const vertex = vertices[i]
    if (!vertex || vertex.size === 0) {
      const text = content[i - 1]
      graph.addEdge({ from: i, to: i - 1, length: 1, value: new Word(i - 1, text, 'pending', false, '', [new Coding(0, '❓', -1)]) })
    }
  }

  // 计算标点顶屏
  for (let i = 1; i <= contentLength; i++) {
    mergeEdge(vertices[i], graph, setting)
  }

  return graph.shortestPath()
}

const parseIdentity = (content: string): string => {
  return content.replace(/-+第(\d+)段.*/, '$1')
}

const replaceContent = (input: string, setting = {
  replaceSpace: false,
  replaceSymbol: false
}) => {
  let content = input
  if (setting.replaceSpace) {
    // 替换空白
    content = content.replace(/\s/gm, '')
  }

  if (setting.replaceSymbol) {
    // 替换符号
    symbolsRegs.forEach(conf => {
      content = content.replace(conf.reg, conf.replacement)
    })
  }

  return content
}

const parseArticle = (content: string, setting: SettingState): ArticleState => {
  let title = '未知'
  let identity = '1'

  const lines = content.split(/\r?\n/).filter(line => line && line.trim().length > 0)
  const totalLines = lines.length
  if (totalLines > 1) {
    // 超过一行时尝试解析
    const sign = lines[totalLines - 1]
    const id = parseIdentity(sign)
    if (id !== sign) {
      identity = id
      if (totalLines === 2) {
        content = lines[0]
      } else {
        title = lines[0]
        content = lines.slice(1, totalLines - 1).join('')
      }

      if (!eapi.verify(content, sign)) {
        throw Error('赛文被篡改，请重新载文')
      }
    }
  }

  content = replaceContent(content, setting)

  return { title, content, identity, shortest: null }
}

const nativeContent = '1）点击『帮助』-『关于』-『快速开始』完成初始设置；2）按下F4快捷键，即刻开始载文；3）F2选择练习文本-发文，可设定击键、速度、码长等复合指标；4）CTRL+L 当前段乱序，CTRL+P 进入下一段'
const webContent = '1）可点击『手动』载文或『粘贴Ctrl+V』自由载文；2）也可F2选择练习文本发文，能设定击键、速度、码长等复合指标；3）阅读，可导入小说开始跟打练习；4）CTRL+L当前段乱序，CTRL+P 进入下一段'

const state: ArticleState = {
  title: '马上可用',
  identity: '1',
  content: isNative ? nativeContent : webContent,
  shortest: null
}

const getters: GetterTree<ArticleState, QuickTypingState> = {
  // 长度
  length ({ content }): number {
    return content.length
  }
}

const mutations: MutationTree<ArticleState> = {
  load (state, article: ArticleState) {
    Object.assign(state, article)
  },

  shortest (state, shortest) {
    state.shortest = shortest
  }
}

const actions: ActionTree<ArticleState, QuickTypingState> = {
  loadText ({ rootState }, content: string): void {
    const { setting } = rootState
    const article = parseArticle(content, setting)
    this.dispatch('article/loadArticle', article)
  },

  loadMatch ({ rootState }, match: Match): void {
    const { title, number, content } = match
    const { setting } = rootState
    const newContent = replaceContent(content, setting)
    const article = {
      title,
      content: newContent,
      identity: number,
      shortest: null
    }
    this.dispatch('article/loadArticle', article)
  },

  random ({ state }): void {
    const article = {
      content: shuffleText(state.content)
    }
    this.dispatch('article/loadArticle', article)
  },

  init ({ state }): void {
    const article = {
      title: state.title,
      content: state.content,
      identity: state.identity,
      shortest: null
    }
    this.dispatch('article/loadArticle', article)
  },

  loadRandomArticle (): void {
    this.dispatch('article/loadServerArticle', eapi.getRandomArticle)
  },

  loadDailyArticle (): void {
    this.dispatch('article/loadServerArticle', eapi.getTodayArticle)
  },

  loadServerArticle ({ state, rootGetters }, apiFunc: Function): void {
    apiFunc().then((data: { id: number; title: string; author: string; content: string }) => {
      const id = data.id
      if (id === state.identity) {
        Message.warning({
          message: '您点得太快了，等会再试啦~'
        })
        return
      }

      const splitedTexts = splitLongText(data.content).map(replaceTextSpace)
      if (splitedTexts.length <= 1) {
        const match = {
          title: `《${data.title}》- ${data.author}`,
          content: replaceTextSpace(data.content),
          number: data.id
        }
        this.dispatch('article/loadMatch', match)
        return
      }

      const article: Partial<KataState> = {
        articleTitle: `《${data.title}》- ${data.author}(总${replaceTextSpace(data.content).length}字)`,
        articleText: splitedTexts.join('\n'),
        textType: 2,
        currentParagraphNo: 1,
        indentity: id,
        paragraphSize: splitedTexts.length
      }

      this.dispatch('kata/loadArticle', article)
      const nextParagraph = rootGetters['kata/nextParagraph']

      this.dispatch('article/loadMatch', nextParagraph)
    }).catch((err: { message: string }) => {
      Message.warning({
        message: `${err.message}`
      })
    })
  },

  loadTodayHistories ({ rootGetters }, type): void {
    eapi.getTodayHistories().then(data => {
      const id = data[0].id
      const isSimple = type === 'simple'

      const article: Partial<KataState> = {
        articleTitle: `《历史上的今天${data[0].date}》`,
        articleText: data.map(d => isSimple ? d.title : `《${d.title}》${d.description}`).join('\n'),
        textType: 2,
        currentParagraphNo: 1,
        indentity: id
      }

      this.dispatch('kata/loadArticle', article)
      const nextParagraph = rootGetters['kata/nextParagraph']

      this.dispatch('article/loadMatch', nextParagraph)
    }).catch(err => {
      Message.warning({
        message: `${err.message}`
      })
    })
  },

  loadLettersAndNumers ({ rootGetters }, type): void {
    let article: Partial<KataState> = {
      articleTitle: '《字母50》',
      articleText: generateRandomLetters(2500),
      textType: 1,
      currentParagraphNo: 1,
      indentity: 400,
      paragraphSize: 50
    }

    if (type === 'letters') {
      article = {
        articleTitle: '《字母50》',
        articleText: generateRandomLetters(2500),
        textType: 1,
        currentParagraphNo: 1,
        indentity: 400,
        paragraphSize: 50
      }
    }
    if (type === 'lettersMix') {
      article = {
        articleTitle: '《字母大小写50》',
        articleText: generateRandomLetters(2500, true),
        textType: 1,
        currentParagraphNo: 1,
        indentity: 450,
        paragraphSize: 50
      }
    }

    if (type === 'numbers') {
      article = {
        articleTitle: '《数字50》',
        articleText: generateRandomNumbers(2500),
        textType: 1,
        currentParagraphNo: 1,
        indentity: 500,
        paragraphSize: 50
      }
    }

    if (type === 'lettersAndNumbers') {
      article = {
        articleTitle: '《字母数字混50》',
        articleText: generateLettersAndNumbers(2500),
        textType: 1,
        currentParagraphNo: 1,
        indentity: 550,
        paragraphSize: 50
      }
    }

    this.dispatch('kata/loadArticle', article)
    const nextParagraph = rootGetters['kata/nextParagraph']

    this.dispatch('article/loadMatch', nextParagraph)
  },

  loadWikiByType ({ state, rootGetters }, type: keyof typeof wikiTypes): void {
    eapi.getWikiByType(type).then(data => {
      const id = data.id
      if (id === state.identity) {
        Message.warning({
          message: '您点得太快了，等会再试啦~'
        })
        return
      }

      const article: Partial<KataState> = {
        articleTitle: `${data.title}`,
        articleText: data.contentList.join('\n'),
        textType: 2,
        currentParagraphNo: 1,
        indentity: id,
        paragraphSize: data.contentList.length
      }

      this.dispatch('kata/loadArticle', article)
      const nextParagraph = rootGetters['kata/nextParagraph']

      this.dispatch('article/loadMatch', nextParagraph)
    }).catch(err => {
      Message.warning({
        message: `${err.message}`
      })
    })
  },

  loadSingle ({ rootGetters }, config): void {
    const { apiFunc, defaultIdentity = 1 } = config
    apiFunc().then((data: { title: string; content: string }) => {
      const article: Partial<KataState> = {
        articleTitle: `${data.title}`,
        articleText: shuffle(data.content.split('')).join(''),
        currentParagraphNo: 1,
        indentity: defaultIdentity,
        paragraphSize: 10
      }

      this.dispatch('kata/loadArticle', article)
      const nextParagraph = rootGetters['kata/nextParagraph']

      this.dispatch('article/loadMatch', nextParagraph)
    }).catch((err: { message: string }) => {
      Message.warning({
        message: `${err.message}`
      })
    })
  },

  loadSingleFront500 (): void {
    this.dispatch('article/loadSingle', {
      apiFunc: eapi.getSingleFront500
    })
  },

  loadSingleMiddle500 (): void {
    this.dispatch('article/loadSingle', {
      apiFunc: eapi.getSingleMiddle500,
      defaultIdentity: 500
    })
  },

  loadSingleEnd500 (): void {
    this.dispatch('article/loadSingle', {
      apiFunc: eapi.getSingleEnd500,
      defaultIdentity: 1000
    })
  },

  loadArticle ({ commit, rootState, rootGetters }, article: ArticleState) {
    commit('load', article)

    setTimeout(() => {
      const { codings, setting } = rootState
      const getSelectChar = rootGetters['setting/getSelectChar']
      const shortest = parse(article.content, codings, setting, getSelectChar)
      if (shortest) {
        commit('shortest', shortest)

        const { path, vertices } = shortest
        const length = path.length
        let codes = ''
        for (let i = 0; i < length;) {
          const edge = vertices[path[i]].get(i)
          if (!edge) {
            break
          }
          const { codings, select, text } = edge.value
          const code = codings ? codings[0].code : text
          codes += (code === '❓' ? text + code : code) + select
          i = path[i]
        }

        this.dispatch('racing/setIdealKeys', codes)
      }
    })

    // 初始化
    this.dispatch('racing/init', null, { root: true })
  }
}

export const article: Module<ArticleState, QuickTypingState> = {
  namespaced: true,
  state,
  getters,
  mutations,
  actions
}
