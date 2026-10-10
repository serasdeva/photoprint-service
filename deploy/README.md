# Production deployment guide

## 1. Prepare environment

```bash
sudo apt update
sudo apt install -y curl git nginx certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

## 2. Deploy project

```bash
sudo mkdir -p /var/www/photoprint-service
cd /var/www/photoprint-service
sudo git clone <repo-url> .
sudo chown -R $USER:$USER /var/www/photoprint-service
npm install
cp deploy/.env.production.example .env
nano .env
```

Replace all placeholders with actual values.

## 3. Seed database

```bash
npm run seed
```

## 4. Start with PM2

```bash
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup
```

## 5. Configure Nginx

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/photoprint
sudo ln -s /etc/nginx/sites-available/photoprint /etc/nginx/sites-enabled/photoprint
sudo nginx -t
sudo systemctl reload nginx
```

## 6. Issue SSL certificate

```bash
sudo certbot --nginx -d your-domain.ru -d www.your-domain.ru
```

## 7. Check application

```bash
curl -I https://your-domain.ru
```

## 8. Useful commands

```bash
pm2 status
pm2 logs photoprint-service
pm2 restart photoprint-service
```

## Notes

- Keep `.env` outside Git.
- Back up the SQLite DB and uploaded files periodically.
- Never expose the admin password in public code.
