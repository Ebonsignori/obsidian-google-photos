import { App, Editor, MarkdownView, Modal, moment, Platform, requestUrl, Setting } from 'obsidian'
import { GridView } from './renderer'
import GooglePhotos from './main'
import { handlebarParse } from './handlebars'

export class PhotosModal extends Modal {
  plugin: GooglePhotos
  gridView: GridView
  editor: Editor
  view: MarkdownView

  constructor (app: App, plugin: GooglePhotos, editor: Editor, view: MarkdownView) {
    super(app)
    this.plugin = plugin
    this.editor = editor
    this.view = view
  }

  /**
   * Save a local thumbnail and insert the thumbnail plus a link back to the original Google Photos location
   * @param event
   */
  async insertImageIntoEditor (event: { target: HTMLImageElement }) {
    try {
      // Remove the photo grid and just show the loading spinner while we wait for the thumbnail to download
      await this.gridView.resetGrid()
      let {photoid, baseurl, producturl, filename = ''} = event.target.dataset
      const src = baseurl + `=w${this.plugin.settings.thumbnailWidth}-h${this.plugin.settings.thumbnailHeight}`
      const noteFolder = this.view.file.path.split('/').slice(0, -1).join('/')
      // Use the note folder or the user-specified folder from Settings
      let thumbnailFolder = noteFolder
      let linkPath = filename
      switch (this.plugin.settings.locationOption) {
        case 'specified':
          thumbnailFolder = this.plugin.settings.locationFolder
          // Set the Markdown image path to be the full specified path + filename
          linkPath = thumbnailFolder + '/' + filename
          break
        case 'subfolder':
          thumbnailFolder = noteFolder + '/' + this.plugin.settings.locationSubfolder
          // Set the Markdown image path to be the subfolder + filename
          linkPath = this.plugin.settings.locationSubfolder + '/' + filename
          break
      }
      thumbnailFolder = thumbnailFolder.replace(/^\/+/, '').replace(/\/+$/, '') // remove any leading/trailing slashes
      linkPath = encodeURI(linkPath)
      // Check to see if the destination folder exists
      const vault = this.view.app.vault
      if (!await vault.adapter.exists(thumbnailFolder)) {
        // Create the folder if not already existing. This works to any depth
        await vault.createFolder(thumbnailFolder)
      }
      // Fetch the thumbnail from Google Photos
      const imageData = await requestUrl({url: src})
      await this.view.app.vault.adapter.writeBinary(thumbnailFolder + '/' + filename, imageData.arrayBuffer)
      const cursorPosition = this.editor.getCursor()
      const linkText = handlebarParse(this.plugin.settings.thumbnailMarkdown, {
        local_thumbnail_link: linkPath,
        google_photo_id: photoid,
        google_photo_url: producturl,
        google_base_url: baseurl
      })
      this.editor.replaceRange(linkText, cursorPosition)
      // Move the cursor to the end of the thumbnail link after pasting
      this.editor.setCursor({line: cursorPosition.line, ch: cursorPosition.ch + linkText.length})
    } catch (e) {
      console.log(e)
    }
    this.close() // close the modal
  }

  onClose () {
    this.gridView?.destroy()
  }
}

export class DailyPhotosModal extends PhotosModal {
  noteDate: moment.Moment
  limitPhotosToNoteDate: boolean = true

  constructor (app: App, plugin: GooglePhotos, editor: Editor, view: MarkdownView) {
    super(app, plugin, editor, view)
  }

  async onOpen () {
    const {contentEl, modalEl} = this
    if (Platform.isDesktop) {
      // Resize to fit the viewport width on desktop
      modalEl.addClass('google-photos-modal-grid')
    }
    this.gridView = new GridView({
      scrollEl: modalEl,
      plugin: this.plugin,
      onThumbnailClick: (event: { target: HTMLImageElement }) => this.insertImageIntoEditor(event)
    })

    // Check for a valid date from the note title
    this.noteDate = moment(this.view.file.basename, this.plugin.settings.parseNoteTitle, true)
    if (this.noteDate.isValid()) {
      // The currently open note has a parsable date
      const dailyNoteParams = {
        filters: {
          dateFilter: {
            dates: [{
              year: +this.noteDate.format('YYYY'),
              month: +this.noteDate.format('M'),
              day: +this.noteDate.format('D')
            }]
          }
        }
      }
      if (this.plugin.settings.defaultToDailyPhotos) {
        // Set the default view to show photos from today
        this.gridView.setSearchParams(dailyNoteParams)
      }

      // Create the checkbox to switch between today / all photos
      new Setting(contentEl)
        .setName('Limit photos to ' + this.noteDate.format('dddd, MMMM D'))
        .setClass('google-photos-fit-content')
        .addToggle(toggle => {
          toggle
            .setValue(this.plugin.settings.defaultToDailyPhotos)
            .onChange(checked => {
              if (checked) {
                this.gridView.setSearchParams(dailyNoteParams)
              } else {
                this.gridView.clearSearchParams()
              }
              this.limitPhotosToNoteDate = checked
              this.gridView.resetGrid()
              this.gridView.getThumbnails()
            })
        })
    }

    // Attach the grid view to the modal
    contentEl.appendChild(this.gridView.containerEl)

    // Start fetching thumbnails!
    await this.gridView.getThumbnails()
  }
}

export class ShowAlbumsModal extends PhotosModal {

  constructor (app: App, plugin: GooglePhotos, editor: Editor, view: MarkdownView) {
    super(app, plugin, editor, view)
  }

  async onOpen () {
    const {contentEl, modalEl} = this
    if (Platform.isDesktop) {
      // Resize to fit the viewport width on desktop
      modalEl.addClass('google-photos-modal-grid')
    }

    console.log(await this.plugin.photosApi.listAlbums())
  }
}