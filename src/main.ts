import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk'

async function main() {
  const status = document.querySelector<HTMLDivElement>('#status')

  try {
    if (status) {
      status.textContent = 'Waiting for Even Hub bridge...'
    }

    const bridge = await waitForEvenAppBridge()

    if (status) {
      status.textContent = 'Bridge connected. Creating page...'
    }

    const pages = [
      'Page 1: Welcome to the Even G2 App!\n\nSwipe up or down to navigate.',
      'Page 2: This is the second page.\n\nUse ring or temple gestures.',
      'Page 3: Third page here.\n\nMore content can be added.',
    ]

    let currentPage = 0

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

    // Set up event listener for gestures
    bridge.onEvenHubEvent((event) => {
      if (event.textEvent && event.textEvent.eventType !== undefined) {
        const eventType = event.textEvent.eventType
        if (eventType === 1) { // SCROLL_TOP_EVENT (swipe up) - next page
          currentPage = (currentPage + 1) % pages.length
        } else if (eventType === 2) { // SCROLL_BOTTOM_EVENT (swipe down) - previous page
          currentPage = (currentPage - 1 + pages.length) % pages.length
        }

        // Update the text container with new page content
        bridge.textContainerUpgrade(
          new TextContainerUpgrade({
            containerID: 1,
            containerName: 'main',
            content: pages[currentPage],
          }),
        )
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