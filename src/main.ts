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

function getImageUrl(src: string) {
  if (src.startsWith('/') || src.startsWith('data:') || /^[a-z][a-z0-9+.-]*:/i.test(src)) {
    return src
  }

  return `/${src}`
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

    let pages = await loadPagesFromFile('/content.json')
    let pageTitles = pages.map(getPageTitle)
    let currentPage = 0

    const pageList = document.querySelector<HTMLUListElement>('#page-list')

    async function createStartupPage(page: SongPage) {
      if (page.type === 'image') {
        // Image page: display 4 quadrants
        const quadrants = await scaleAndSplitImage(getImageUrl(page.src))

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
        const quadrants = await scaleAndSplitImage(getImageUrl(page.src))

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

    function handleFileImport(file: File) {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string
          const newPages = parseSongbookJson(JSON.parse(text))

          // Update pages array
          pages = newPages
          pageTitles = pages.map(getPageTitle)
          currentPage = 0

          // Re-render the page list and load the first page
          renderPageIndex()
          void updatePageContent(currentPage)

          if (status) {
            status.textContent = `Loaded ${newPages.length} pages from ${file.name}`
          }
        } catch (error) {
          console.error('Error importing file:', error)
          if (status) {
            status.textContent = `Error importing file: ${error instanceof Error ? error.message : 'Unknown error'}`
          }
        }
      }
      reader.readAsText(file)
    }

    if (importBtn) {
      importBtn.addEventListener('click', () => {
        fileInput?.click()
      })
    }

    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (file) {
          handleFileImport(file)
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
