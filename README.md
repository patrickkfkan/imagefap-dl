<a href='https://ko-fi.com/C0C5RGOOP' target='_blank'><img height='36' style='border:0px;height:36px;' src='https://storage.ko-fi.com/cdn/kofi2.png?v=3' border='0' alt='Buy Me a Coffee at ko-fi.com' /></a>

# imagefap-dl

An ImageFap gallery downloader written in [Node.js](https://nodejs.org).

## Installation

First, install [Node.js](https://nodejs.org/en).

Then, in a terminal, run the following command:

```
npm i -g imagefap-dl
```

## Usage

In a terminal:
```
// Download all galleries uploaded by johndoe to the current directory
$ imagefap-dl "https://www.imagefap.com/profile/johndoe/galleries"

// Download a single gallery to "C:\Downloads"
$ imagefap-dl -o "C:\Downloads" "https://www.imagefap.com/gallery/1234567"

// Download from the list of URLs contained in file "urls.txt"
$ imagefap-dl urls.txt

// urls.txt
------------------------------------------------------
https://www.imagefap.com/profile/johndoe/galleries
https://www.imagefap.com/gallery/1234567

# Lines starting with # are ignored
# https://www.imagefap.com/gallery/9876543 --> Ignored
```

> URLs can be copy-and-pasted from the ImageFap website. Make sure they conform to one of the formats listed in the usage guide (below).

To display usage guide:
```
$ imagefap-dl -h
```
Output:
```
Usage

  imagefap-dl [OPTION]... TARGET 

TARGET

  Target can be a URL or a file containing a list of URLs to download from.     
                                                                                
  Supported URL formats                                                         
  ---------------------                                                         

  Download all galleries by a user:                                             
  - https://www.imagefap.com/profile/<username>/galleries                       
                                                                                
  Download all galleries in a folder:                                           
  - https://www.imagefap.com/profile/<username>/galleries?folderid=<folder-id>  
  - https://www.imagefap.com/organizer/<folder-id>/<folder-slug>                
  - https://www.imagefap.com/usergallery.php?userid=<user-id>&folderid=<folder-id>
                                                                                
  Download a single gallery:                                                    
  - https://www.imagefap.com/gallery/<gallery-id>                               
  - https://www.imagefap.com/gallery.php?gid=<gallery-id>                       
  - https://www.imagefap.com/pictures/<gallery-id>/<gallery-slug>               

  Download all user favorites:                                                  
  - https://www.imagefap.com/showfavorites.php?userid=<user-id>                 
                                                                                
  Download user favorites by folder:                                            
  - https://www.imagefap.com/showfavorites.php?userid=<user-id>&folderid=<folder-id> 
                                                                                
  File                                                                          
  ----                                                                          
                                                                                
  Files must be in plain text format with each URL placed in its own line.      
  Lines starting with # are ignored.                                            

Options

  -h, --help                            Display this usage guide                
  -o, --out-dir <dir>                   Path to directory where content is      
                                        saved. Default: current working         
                                        directory                               
  -d, --dir-structure <flags>           Combination of flags controlling the    
                                        output directory structure of           
                                        downloaded galleries. See "Directory    
                                        structure flags" section for available  
                                        flags.                                  
  -n, --seq-filenames                   Add sequential numbers to beginning of  
                                        filenames based on display order of     
                                        images.
  -f, --full-filenames                  Use full filename for image downloads.  
                                        If not specified, filenames may be      
                                        truncated. Note: getting full filenames 
                                        involves extra page requests that will  
                                        increase download time.                 
  -w, --overwrite                       Overwrite existing image files          
  -j, --no-json                         Do not save gallery info in JSON file   
  -m, --no-html                         Do not save original HTML               
  -l, --log-level <level>               Log level: 'info', 'debug', 'warn' or   
                                        'error'; set to 'none' to disable       
                                        logging. Default: info                  
  -s, --log-file <path>                 Save logs to <path>                     
  -r, --max-retries <number>            Maximum retry attempts when a download  
                                        fails. Default: 3                       
  -c, --max-concurrent <number>         Maximum number of concurrent image      
                                        downloads. Default: 10                  
  -p, --min-time-page <milliseconds>    Minimum time to wait between page fetch 
                                        requests. As a general rule, do not     
                                        set this lower than 2000, otherwise you 
                                        will likely get 'Too many requests'     
                                        errors. Default: 2000                   
  -i, --min-time-image <milliseconds>   Minimum time to wait between image      
                                        download requests. Default: 200     
  --proxy <URI>                         Use the specified proxy. The URI        
                                        follows this scheme:                    
                                        "protocol://[username:[password]]@host:port". 
                                        Protocol can be http, https, socks4 or  
                                        socks5.                                 
  --proxy-insecure                      Do not reject invalid certificate when  
                                        connecting to proxy through SSL / TLS.  
                                        Use this option for proxies with self-  
                                        signed certs.          
  -y, --no-prompt                       Do not prompt for confirmation to       
                                        proceed                                 

Directory structure flags (--dir-structure)

  When downloading a gallery, the following flags specify which directory is to 
  be included in the output directory structure:                                

  u   If downloading user favorites, include directory for the user; otherwise, 
      include directory for uploader of the gallery (note: does not apply when  
      uploader is anonymous)                                                    
  v   Include "Favorites" directory (only applies when downloading user         
      favorites)
  f   Include directory for folder containing the gallery (note: does not apply 
      when downloading a single gallery)                                        
  g   Include directory for the gallery itself                                  
  -   No directory structure. All images will be downloaded to --out-dir.       

  Default: uvfg 
```

## Changelog

v2.1.0
- Add proxy support ([#6](https://github.com/patrickkfkan/imagefap-dl/issues/6))
- Add support for downloading from multiple URLs ([#8](https://github.com/patrickkfkan/imagefap-dl/issues/8))

v2.0.0
- Add support for downloading user favorites ([#5](https://github.com/patrickkfkan/imagefap-dl/issues/5))
- Add `--seq-filenames` option
- Bump minimum required version of Node.js to v18

v1.2.0
- Add `--full-filenames` option ([#2](https://github.com/patrickkfkan/imagefap-dl/issues/2))

v1.1.1
- Fix download of galleries from anonymous uploaders

v1.1.0
- Optimize fetching of image URLs
- Misc bug fixes

v1.0.0
- Initial release

## License

MIT