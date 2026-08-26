import os
import json
import re
import datetime
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
import time

def download_pdfs(url, output_dir):
    os.makedirs(output_dir, exist_ok=True)
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    
    print(f"Fetching main page: {url}")
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    
    soup = BeautifulSoup(response.content, 'html.parser')
    
    season_links = set()
    for a in soup.find_all('a', href=True):
        href = a['href']
        if '-season-results/' in href.lower():
            season_links.add(urljoin(url, href))
            
    print(f"Found {len(season_links)} season result pages.")
    
    all_pdfs = []
    
    for season_url in season_links:
        print(f"Fetching season page: {season_url}")
        try:
            res = requests.get(season_url, headers=headers)
            res.raise_for_status()
            season_soup = BeautifulSoup(res.content, 'html.parser')
            
            for a in season_soup.find_all('a', href=True):
                href = a['href']
                if '.pdf' in href.lower():
                    pdf_url = urljoin(season_url, href)
                    location = a.text.strip()
                    if not location:
                        location = "Unknown"
                        
                    # Extract year from filename if possible
                    year = 2024 # default fallback
                    match = re.search(r'20\d{2}', pdf_url)
                    if match:
                        year = int(match.group(0))
                        
                    all_pdfs.append({
                        "url": pdf_url,
                        "location": location,
                        "year": year
                    })
        except Exception as e:
            print(f"Error fetching {season_url}: {e}")
            
        time.sleep(1) # Be polite
            
    # Deduplicate by url
    unique_pdfs = {p['url']: p for p in all_pdfs}.values()
    all_pdfs = list(unique_pdfs)
    
    print(f"Found {len(all_pdfs)} unique PDF links across all seasons.")
    
    for i, pdf_info in enumerate(all_pdfs):
        pdf_url = pdf_info['url']
        location = pdf_info['location']
        year = pdf_info['year']
        
        try:
            parsed = urlparse(pdf_url)
            filename = os.path.basename(parsed.path)
            if not filename.lower().endswith('.pdf'):
                filename = f"document_{i}.pdf"
                
            filepath = os.path.join(output_dir, filename)
            json_filename = filename.rsplit('.', 1)[0] + '.json'
            json_filepath = os.path.join(output_dir, json_filename)
            
            # Create json meta file
            meta_data = {
                "organization": "Hollywood Vibe",
                "organization_slug": "hollywoodvibe",
                "year": year,
                "location": location,
                "date": "Unknown",
                "event_name": f"Hollywood Vibe - {location} - {year}",
                "source_url": pdf_url,
                "downloaded_at": datetime.datetime.utcnow().isoformat() + "Z"
            }
            
            with open(json_filepath, 'w') as f:
                json.dump(meta_data, f, indent=2)
            
            # Skip downloading if pdf already exists
            if os.path.exists(filepath):
                continue
                
            print(f"[{i+1}/{len(all_pdfs)}] Downloading {filename}...")
            pdf_resp = requests.get(pdf_url, headers=headers, stream=True)
            pdf_resp.raise_for_status()
            
            with open(filepath, 'wb') as f:
                for chunk in pdf_resp.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            time.sleep(0.5)  # Be polite
        except Exception as e:
            print(f"Failed to process {pdf_url}: {e}")

if __name__ == '__main__':
    url = "https://www.hollywoodvibe.com/results/"
    output_dir = "tobeprocessed/pdf/hollywoodvibe"
    download_pdfs(url, output_dir)
