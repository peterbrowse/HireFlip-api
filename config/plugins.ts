export default () => ({
  upload: {
    config: {
        provider: "@strapi/provider-upload-cloudinary",
        providerOptions: {
            cloud_name: process.env.CLOUDINARY_NAME,
            api_key: process.env.CLOUDINARY_KEY,
            api_secret: process.env.CLOUDINARY_SECRET,
        },
        breakpoints: [],
        actionOptions: {
            uploadStream: {
                use_filename: false,
                unique_filename: true,
                overwrite: false,
                folder: process.env.CLOUDINARY_FOLDER,
                transformation: [
                    { fetch_format: "auto" }
                ]
            }
        },
    },
  },
});