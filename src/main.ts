import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk'

async function loadPagesFromFile(url: string): Promise<string[]> {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to load ${url}: ${response.status}`)
    }
    const text = await response.text()
    const rawPages = text.split(/\r?\n--\r?\n/)
    const pages = rawPages.map((page) => page.trim()).filter((page) => page.length > 0)
    if (pages.length > 0) {
      return pages
    }
    throw new Error('No pages found in content file')
  } catch (error) {
    console.warn(error)
    return [
      'Page 1: Failed to load data from content file\n\nthis is default data!\n\nSwipe up or down to navigate.',
      'Page 2: This is the second page.\n\nUse ring or temple gestures.',
      'Page 3: Third page here.\n\nMore content can be added.',
    ]
  }
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

    const pages = await loadPagesFromFile('/content.txt')
    const pageTitles = pages.map((page) => page.split('\n')[0]?.trim() ?? 'Untitled')
    let currentPage = 0

    const pageList = document.querySelector<HTMLUListElement>('#page-list')

    const mainText = new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: 288,
      borderWidth: 0,
      borderColor: 5,
      paddingLength: 4,
      containerID: 1,
      containerName: 'main',
      content: pages[currentPage],
      isEventCapture: 1,
    })

    const result = await bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: 1,
        textObject: [mainText],
      }),
    )

    if (status) {
      status.textContent = `Page created. Result: ${result}`
    }

    console.log('createStartUpPageContainer result:', result)

    function updatePageContent(index: number) {
      currentPage = index
      const newContent = pages[currentPage]
      bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: 1,
          containerName: 'main',
          content: newContent,
        }),
      )

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

      pageList.innerHTML = pageTitles
        .map(
          (title, index) =>
            `<li><button type="button" data-index="${index}">${title}</button></li>`,
        )
        .join('')

      pageList.querySelectorAll('button').forEach((button) => {
        button.addEventListener('click', () => {
          const index = Number(button.dataset.index)
          if (!Number.isNaN(index)) {
            updatePageContent(index)
          }
        })
      })

      updatePageContent(currentPage)
    }

    renderPageIndex()

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