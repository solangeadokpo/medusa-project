const express = require("express")
const { GracefulShutdownServer } = require("medusa-core-utils")

// Try one of these import methods:
// Option 1: Direct require
const loaders = require("@medusajs/medusa/dist/loaders").default

// Option 2: Alternative path (uncomment if Option 1 doesn't work)
// const loaders = require("@medusajs/medusa/dist/loaders/index")

// Option 3: Without .default (uncomment if others don't work)
// const loaders = require("@medusajs/medusa/dist/loaders")

;(async () => {
  async function start() {
    const app = express()
    const directory = process.cwd()

    try {
      const { container } = await loaders({
        directory,
        expressApp: app
      })
      const configModule = container.resolve("configModule")
      const port = process.env.PORT ?? configModule.projectConfig.port ?? 9000

      const server = GracefulShutdownServer.create(
        app.listen(port, (err) => {
          if (err) {
            return
          }
          console.log(`Server is ready on port: ${port}`)
        })
      )

      // Handle graceful shutdown
      const gracefulShutDown = () => {
        server
          .shutdown()
          .then(() => {
            console.info("Gracefully stopping the server.")
            process.exit(0)
          })
          .catch((e) => {
            console.error("Error received when shutting down the server.", e)
            process.exit(1)
          })
      }
      process.on("SIGTERM", gracefulShutDown)
      process.on("SIGINT", gracefulShutDown)
    } catch (err) {
      console.error("Error starting server", err)
      process.exit(1)
    }
  }

  await start()
})()