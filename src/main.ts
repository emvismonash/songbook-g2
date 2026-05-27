import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  RebuildPageContainer,
} from '@evenrealities/even_hub_sdk'

type TextSongPage = {
  type: 'text'
  content: string
  title?: string
}

type ImageSongPage = {
  type: 'image'
  src: string
  title?: string
}

type SongPage = TextSongPage | ImageSongPage

type StoredImageAsset = {
  keys: string[]
  blob: Blob
  name: string
  type: string
  updatedAt: number
}

type StoredSongbook = {
  id: string
  pages: SongPage[]
  assets: StoredImageAsset[]
  sourceName: string
  updatedAt: number
}

const SONGBOOK_DB_NAME = 'songbook-g2'
const SONGBOOK_DB_VERSION = 1
const SONGBOOK_STORE_NAME = 'songbooks'
const CURRENT_SONGBOOK_ID = 'current'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getOptionalTitle(page: Record<string, unknown>): string | undefined {
  return typeof page.title === 'string' && page.title.trim().length > 0
    ? page.title.trim()
    : undefined
}

function getTextContent(page: Record<string, unknown>, index: number) {
  if (typeof page.content === 'string') {
    return page.content
  }

  if (Array.isArray(page.lines) && page.lines.every((line) => typeof line === 'string')) {
    return page.lines.join('\n')
  }

  throw new Error(`Text page ${index + 1} must include content or lines`)
}

function parseSongPage(page: unknown, index: number): SongPage {
  if (!isRecord(page)) {
    throw new Error(`Page ${index + 1} must be an object`)
  }

  if (page.type === 'image') {
    if (typeof page.src !== 'string' || page.src.trim().length === 0) {
      throw new Error(`Image page ${index + 1} must include a src`)
    }

    return {
      type: 'image',
      src: page.src.trim(),
      title: getOptionalTitle(page),
    }
  }

  if (page.type === 'text') {
    const content = getTextContent(page, index)
    if (content.trim().length === 0) {
      throw new Error(`Text page ${index + 1} must not be empty`)
    }

    return {
      type: 'text',
      content,
      title: getOptionalTitle(page),
    }
  }

  throw new Error(`Page ${index + 1} must have type "image" or "text"`)
}

function parseSongbookJson(data: unknown): SongPage[] {
  const rawPages = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.pages)
      ? data.pages
      : null

  if (!rawPages) {
    throw new Error('Songbook JSON must be an array or an object with a pages array')
  }

  const pages = rawPages.map(parseSongPage)
  if (pages.length === 0) {
    throw new Error('No pages found in songbook JSON')
  }

  return pages
}

async function loadPagesFromFile(url: string): Promise<SongPage[]> {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to load ${url}: ${response.status}`)
    }
    const data = await response.json()
    return parseSongbookJson(data)
  } catch (error) {
    console.warn(error)
    return [
      {
        type: 'text',
        title: 'Fallback page 1',
        content:
          'Page 1: Failed to load data from JSON content file\n\nthis is default data!\n\nSwipe up or down to navigate.',
      },
      {
        type: 'text',
        content: 'Page 2: This is the second page.\n\nUse ring or temple gestures.',
      },
      {
        type: 'text',
        content: 'Page 3: Third page here.\n\nMore content can be added.',
      },
    ]
  }
}

function getPageTitle(page: SongPage) {
  if (page.title) {
    return page.title
  }

  if (page.type === 'image') {
    return page.src
  }

  return page.content
    .split('\n')
    .find((line) => line.trim().length > 0)
    ?.trim() ?? 'Untitled'
}

function getStaticImageUrl(src: string) {
  if (src.startsWith('/') || src.startsWith('data:') || /^[a-z][a-z0-9+.-]*:/i.test(src)) {
    return src
  }

  return `/${src}`
}

function getAssetKey(src: string) {
  return src.replace(/^\.?\//, '')
}

function getAssetFileName(src: string) {
  return getAssetKey(src).split('/').pop() ?? src
}

function isPngFile(file: File) {
  return file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')
}

function isJsonFile(file: File) {
  return file.type === 'application/json' || file.name.toLowerCase().endsWith('.json')
}

function revokeUploadedImageUrls(imageUrls: Map<string, string>) {
  new Set(imageUrls.values()).forEach((url) => URL.revokeObjectURL(url))
  imageUrls.clear()
}

function createImageAssetsFromFiles(files: File[]) {
  const now = Date.now()

  return files.filter(isPngFile).map((file) => {
    const keys = new Set([file.name])

    if (file.webkitRelativePath) {
      keys.add(getAssetKey(file.webkitRelativePath))
    }

    return {
      keys: Array.from(keys),
      blob: file.slice(0, file.size, file.type || 'image/png'),
      name: file.name,
      type: file.type || 'image/png',
      updatedAt: now,
    }
  })
}

function createUploadedImageUrls(assets: StoredImageAsset[]) {
  const imageUrls = new Map<string, string>()

  assets.forEach((asset) => {
    const objectUrl = URL.createObjectURL(asset.blob)
    asset.keys.forEach((key) => {
      imageUrls.set(key, objectUrl)
    })
  })

  return imageUrls
}

function resolveImageUrl(src: string, uploadedImageUrls: Map<string, string>) {
  const uploadedUrl =
    uploadedImageUrls.get(src) ??
    uploadedImageUrls.get(getAssetKey(src)) ??
    uploadedImageUrls.get(getAssetFileName(src))

  return uploadedUrl ?? getStaticImageUrl(src)
}

function openSongbookDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(SONGBOOK_DB_NAME, SONGBOOK_DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SONGBOOK_STORE_NAME)) {
        db.createObjectStore(SONGBOOK_STORE_NAME, { keyPath: 'id' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open songbook database'))
  })
}

function waitForIdbRequest<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function waitForTransaction(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
  })
}

function isStoredImageAsset(value: unknown): value is StoredImageAsset {
  return (
    isRecord(value) &&
    Array.isArray(value.keys) &&
    value.keys.every((key) => typeof key === 'string') &&
    value.blob instanceof Blob &&
    typeof value.name === 'string' &&
    typeof value.type === 'string' &&
    typeof value.updatedAt === 'number'
  )
}

function parseStoredSongbook(value: unknown): StoredSongbook | null {
  if (!isRecord(value)) {
    return null
  }

  const pages = parseSongbookJson(value.pages)
  const assets = Array.isArray(value.assets) ? value.assets.filter(isStoredImageAsset) : []

  return {
    id: typeof value.id === 'string' ? value.id : CURRENT_SONGBOOK_ID,
    pages,
    assets,
    sourceName: typeof value.sourceName === 'string' ? value.sourceName : 'saved content.json',
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
  }
}

async function loadStoredSongbook() {
  if (!('indexedDB' in window)) {
    return null
  }

  let db: IDBDatabase | null = null

  try {
    db = await openSongbookDb()
    const transaction = db.transaction(SONGBOOK_STORE_NAME, 'readonly')
    const stored = await waitForIdbRequest(transaction.objectStore(SONGBOOK_STORE_NAME).get(CURRENT_SONGBOOK_ID))
    return parseStoredSongbook(stored)
  } catch (error) {
    console.warn('Could not load saved songbook:', error)
    return null
  } finally {
    db?.close()
  }
}

async function saveStoredSongbook(pages: SongPage[], assets: StoredImageAsset[], sourceName: string) {
  if (!('indexedDB' in window)) {
    throw new Error('IndexedDB is not available')
  }

  const db = await openSongbookDb()

  try {
    const transaction = db.transaction(SONGBOOK_STORE_NAME, 'readwrite')
    transaction.objectStore(SONGBOOK_STORE_NAME).put({
      id: CURRENT_SONGBOOK_ID,
      pages,
      assets,
      sourceName,
      updatedAt: Date.now(),
    } satisfies StoredSongbook)
    await waitForTransaction(transaction)
  } finally {
    db.close()
  }
}

async function scaleAndSplitImage(imageUrl: string): Promise<Uint8Array[]> {
  const response = await fetch(imageUrl)
  const blob = await response.blob()
  const bitmap = await createImageBitmap(blob)

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!

  // Scale image to fit 576x288
  const scale = Math.min(576 / bitmap.width, 288 / bitmap.height)
  const scaledWidth = Math.floor(bitmap.width * scale)
  const scaledHeight = Math.floor(bitmap.height * scale)

  // Create scaled image
  canvas.width = 576
  canvas.height = 288
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 576, 288)

  // Center the scaled image
  const x = (576 - scaledWidth) / 2
  const y = (288 - scaledHeight) / 2
  ctx.drawImage(bitmap, x, y, scaledWidth, scaledHeight)

  // Extract 4 quadrants (288x144 each) and convert to PNG
  const quadrants: Uint8Array[] = []
  const positions = [
    { x: 0, y: 0 }, // top-left
    { x: 288, y: 0 }, // top-right
    { x: 0, y: 144 }, // bottom-left
    { x: 288, y: 144 }, // bottom-right
  ]

  for (const pos of positions) {
    const quadCanvas = document.createElement('canvas')
    quadCanvas.width = 288
    quadCanvas.height = 144
    const quadCtx = quadCanvas.getContext('2d')!
    quadCtx.drawImage(canvas, pos.x, pos.y, 288, 144, 0, 0, 288, 144)

    // Convert canvas to PNG blob and then to Uint8Array
    const dataUrl = quadCanvas.toDataURL('image/png')
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '')
    const binaryString = atob(base64Data)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    quadrants.push(bytes)
  }

  bitmap.close()
  return quadrants
}

async function main() {
  const status = document.querySelector<HTMLDivElement>('#status')

  try {
    if (status) {
      status.textContent = 'Waiting for Even Hub bridge...'
    }

    const bridge = await waitForEvenAppBridge()

    if (status) {
      status.textContent = 'Bridge connected. Loading page content...'
    }

    const storedSongbook = await loadStoredSongbook()
    let uploadedImageUrls = storedSongbook
      ? createUploadedImageUrls(storedSongbook.assets)
      : new Map<string, string>()
    let pages = storedSongbook?.pages ?? await loadPagesFromFile('/content.json')
    let pageTitles = pages.map(getPageTitle)
    let currentPage = 0

    const pageList = document.querySelector<HTMLUListElement>('#page-list')

    async function createStartupPage(page: SongPage) {
      if (page.type === 'image') {
        // Image page: display 4 quadrants
        const quadrants = await scaleAndSplitImage(resolveImageUrl(page.src, uploadedImageUrls))

        const imageContainers = [
          new ImageContainerProperty({
            xPosition: 0,
            yPosition: 0,
            width: 288,
            height: 144,
            containerID: 1,
            containerName: 'quad-tl',
          }),
          new ImageContainerProperty({
            xPosition: 288,
            yPosition: 0,
            width: 288,
            height: 144,
            containerID: 2,
            containerName: 'quad-tr',
          }),
          new ImageContainerProperty({
            xPosition: 0,
            yPosition: 144,
            width: 288,
            height: 144,
            containerID: 3,
            containerName: 'quad-bl',
          }),
          new ImageContainerProperty({
            xPosition: 288,
            yPosition: 144,
            width: 288,
            height: 144,
            containerID: 4,
            containerName: 'quad-br',
          }),
        ]

        // Add invisible text container for event capture
        const eventContainer = new TextContainerProperty({
          xPosition: 0,
          yPosition: 0,
          width: 576,
          height: 288,
          containerID: 5,
          containerName: 'event-layer',
          content: '',
          isEventCapture: 1,
        })

        const result = await bridge.createStartUpPageContainer(
          new CreateStartUpPageContainer({
            containerTotalNum: 5,
            textObject: [eventContainer],
            imageObject: imageContainers,
          }),
        )

        if (status) {
          status.textContent = `Page created. Result: ${result}`
        }

        // Update all 4 quadrants with image data
        for (let i = 0; i < 4; i++) {
          await bridge.updateImageRawData(
            new ImageRawDataUpdate({
              containerID: i + 1,
              containerName: imageContainers[i].containerName,
              imageData: quadrants[i],
            }),
          )
        }
      } else {
        // Text page
        const textContainer = new TextContainerProperty({
          xPosition: 0,
          yPosition: 0,
          width: 576,
          height: 288,
          borderWidth: 0,
          borderColor: 5,
          paddingLength: 4,
          containerID: 1,
          containerName: 'main-text',
          content: page.content,
          isEventCapture: 1,
        })

        const result = await bridge.createStartUpPageContainer(
          new CreateStartUpPageContainer({
            containerTotalNum: 1,
            textObject: [textContainer],
          }),
        )

        if (status) {
          status.textContent = `Page created. Result: ${result}`
        }
      }
    }

    async function updatePageContent(index: number) {
      currentPage = index
      const page = pages[currentPage]

      if (page.type === 'image') {
        // Image page: display 4 quadrants
        const quadrants = await scaleAndSplitImage(resolveImageUrl(page.src, uploadedImageUrls))

        const imageContainers = [
          new ImageContainerProperty({
            xPosition: 0,
            yPosition: 0,
            width: 288,
            height: 144,
            containerID: 1,
            containerName: 'quad-tl',
          }),
          new ImageContainerProperty({
            xPosition: 288,
            yPosition: 0,
            width: 288,
            height: 144,
            containerID: 2,
            containerName: 'quad-tr',
          }),
          new ImageContainerProperty({
            xPosition: 0,
            yPosition: 144,
            width: 288,
            height: 144,
            containerID: 3,
            containerName: 'quad-bl',
          }),
          new ImageContainerProperty({
            xPosition: 288,
            yPosition: 144,
            width: 288,
            height: 144,
            containerID: 4,
            containerName: 'quad-br',
          }),
        ]

        // Add invisible text container for event capture
        const eventContainer = new TextContainerProperty({
          xPosition: 0,
          yPosition: 0,
          width: 576,
          height: 288,
          containerID: 5,
          containerName: 'event-layer',
          content: '',
          isEventCapture: 1,
        })

        await bridge.rebuildPageContainer(
          new RebuildPageContainer({
            containerTotalNum: 5,
            textObject: [eventContainer],
            imageObject: imageContainers,
          }),
        )

        // Update all 4 quadrants with image data
        for (let i = 0; i < 4; i++) {
          await bridge.updateImageRawData(
            new ImageRawDataUpdate({
              containerID: i + 1,
              containerName: imageContainers[i].containerName,
              imageData: quadrants[i],
            }),
          )
        }
      } else {
        // Text page
        const textContainer = new TextContainerProperty({
          xPosition: 0,
          yPosition: 0,
          width: 576,
          height: 288,
          borderWidth: 0,
          borderColor: 5,
          paddingLength: 4,
          containerID: 1,
          containerName: 'main-text',
          content: page.content,
          isEventCapture: 1,
        })

        await bridge.rebuildPageContainer(
          new RebuildPageContainer({
            containerTotalNum: 1,
            textObject: [textContainer],
          }),
        )
      }

      if (status) {
        status.textContent = `Showing: ${pageTitles[currentPage]}`
      }

      if (!pageList) {
        return
      }

      pageList.querySelectorAll('button').forEach((button, buttonIndex) => {
        button.classList.toggle('selected', buttonIndex === currentPage)
      })
    }

    function renderPageIndex() {
      if (!pageList) {
        return
      }

      pageList.replaceChildren()

      pageTitles.forEach((title, index) => {
        const listItem = document.createElement('li')
        const button = document.createElement('button')
        button.type = 'button'
        button.dataset.index = String(index)
        button.textContent = title

        button.addEventListener('click', () => {
          void updatePageContent(index)
        })

        listItem.append(button)
        pageList.append(listItem)
      })

      void updatePageContent(currentPage)
    }

    await createStartupPage(pages[currentPage])
    renderPageIndex()

    // File import handler
    const importBtn = document.querySelector<HTMLButtonElement>('#import-btn')
    const fileInput = document.querySelector<HTMLInputElement>('#file-input')

    async function handleFileImport(fileList: FileList) {
      const files = Array.from(fileList)
      const jsonFile = files.find(isJsonFile)

      if (!jsonFile) {
        if (status) {
          status.textContent = 'Choose a content.json file to import.'
        }
        return
      }

      try {
        const newPages = parseSongbookJson(JSON.parse(await jsonFile.text()))
        const imageAssets = createImageAssetsFromFiles(files)
        const newUploadedImageUrls = createUploadedImageUrls(imageAssets)
        let savedToDevice = true

        try {
          await saveStoredSongbook(newPages, imageAssets, jsonFile.name)
        } catch (error) {
          savedToDevice = false
          console.warn('Imported songbook could not be saved:', error)
        }

        revokeUploadedImageUrls(uploadedImageUrls)
        uploadedImageUrls = newUploadedImageUrls

        // Update pages array
        pages = newPages
        pageTitles = pages.map(getPageTitle)
        currentPage = 0

        // Re-render the page list and load the first page
        renderPageIndex()

        if (status) {
          const imageCount = new Set(newUploadedImageUrls.values()).size
          status.textContent =
            `Loaded ${newPages.length} pages and ${imageCount} image${imageCount === 1 ? '' : 's'} from ${jsonFile.name}` +
            (savedToDevice ? ' and saved them on this device.' : ', but could not save them on this device.')
        }
      } catch (error) {
        console.error('Error importing files:', error)
        if (status) {
          status.textContent = `Error importing files: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    }

    if (importBtn) {
      importBtn.addEventListener('click', () => {
        fileInput?.click()
      })
    }

    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const files = (e.target as HTMLInputElement).files
        if (files && files.length > 0) {
          void handleFileImport(files)
          // Reset the input so the same file can be imported again
          fileInput.value = ''
        }
      })
    }

    bridge.onEvenHubEvent((event) => {
      if (event.textEvent && event.textEvent.eventType !== undefined) {
        const eventType = event.textEvent.eventType
        if (eventType === 1) { // SCROLL_TOP_EVENT (swipe up) - previous page
          updatePageContent((currentPage - 1 + pages.length) % pages.length)
        } else if (eventType === 2) { // SCROLL_BOTTOM_EVENT (swipe down) - next page
          updatePageContent((currentPage + 1) % pages.length)
        }
      }
    })
  } catch (error) {
    console.error(error)

    if (status) {
      status.textContent =
        'Could not connect to Even Hub bridge. Run this in the simulator or on glasses.'
    }
  }
}

main()
