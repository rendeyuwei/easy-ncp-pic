import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type Route } from '@playwright/test';

const fixture02Path = fileURLToPath(new URL('../../ncp-parser/test/fixtures/PICCON02.NCP', import.meta.url));
const fixture33Path = fileURLToPath(new URL('../../ncp-parser/test/fixtures/PICCON33.NCP', import.meta.url));

async function login(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('用户名').fill('admin');
  await page.getByLabel('密码').fill('admin-e2e-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/filters$/);
  await expect(page.getByRole('heading', { name: '滤镜', exact: true })).toBeVisible();
}

async function useResponsiveNavigation(page: Page, projectName: string, destination: '分类' | '滤镜') {
  if (projectName === 'desktop') {
    await page.getByRole('navigation', { name: '主管理导航' }).getByRole('link', { name: destination }).click();
  } else {
    await page.getByRole('button', { name: '打开导航菜单' }).click();
    await page.getByRole('navigation', { name: '移动管理导航' }).getByRole('link', { name: destination }).click();
  }
  await expect(page.getByRole('heading', { name: destination, exact: true })).toBeVisible();
}

async function cleanupBulkImportRecords(
  page: Page,
  filterNames: readonly string[],
  categoryNames: readonly string[],
) {
  const failures = await page.evaluate(async ({ filtersToDelete, categoriesToDelete }) => {
    const cleanupFailures: string[] = [];
    try {
      const sessionResponse = await fetch('/api/admin/session');
      const session = await sessionResponse.json() as { csrfToken?: string };
      if (!sessionResponse.ok || !session.csrfToken) {
        return [`session: ${sessionResponse.status}`];
      }
      const headers = { 'x-csrf-token': session.csrfToken };
      const filtersResponse = await fetch('/api/admin/filters');
      if (!filtersResponse.ok) {
        cleanupFailures.push(`filters list: ${filtersResponse.status}`);
      } else {
        const filtersBody = await filtersResponse.json() as {
          filters?: Array<{ id: string; displayName: string }>;
        };
        for (const filter of filtersBody.filters ?? []) {
          if (!filtersToDelete.includes(filter.displayName)) continue;
          const response = await fetch(`/api/admin/filters/${encodeURIComponent(filter.id)}`, {
            method: 'DELETE',
            headers,
          });
          if (!response.ok) cleanupFailures.push(`filter ${filter.displayName}: ${response.status}`);
        }
      }

      const categoriesResponse = await fetch('/api/admin/categories');
      if (!categoriesResponse.ok) {
        cleanupFailures.push(`categories list: ${categoriesResponse.status}`);
      } else {
        const categoriesBody = await categoriesResponse.json() as {
          categories?: Array<{ id: string; name: string }>;
        };
        for (const category of categoriesBody.categories ?? []) {
          if (!categoriesToDelete.includes(category.name)) continue;
          const response = await fetch(`/api/admin/categories/${encodeURIComponent(category.id)}`, {
            method: 'DELETE',
            headers,
          });
          if (!response.ok) cleanupFailures.push(`category ${category.name}: ${response.status}`);
        }
      }
    } catch (error) {
      cleanupFailures.push(error instanceof Error ? error.message : String(error));
    }
    return cleanupFailures;
  }, { filtersToDelete: filterNames, categoriesToDelete: categoryNames });

  expect.soft(failures, 'bulk import records should be removed during cleanup').toEqual([]);
}

test.describe('desktop lifecycle', () => {
  test('publishes, persists, constrains, and cleans up a real NCP filter', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The shared database lifecycle runs once on desktop.');

    const unique = `${Date.now()}-${process.pid}`;
    const categoryName = `Film E2E ${unique}`;
    const categorySlug = `film-e2e-${unique}`;
    const filterName = `PICCON02 E2E ${unique}`;
    const editedFilterName = `${filterName} Edited`;

    await login(page);
    await page.getByRole('navigation', { name: '主管理导航' }).getByRole('link', { name: '分类' }).click();
    await page.getByRole('button', { name: '新增分类' }).first().click();

    const categoryDialog = page.getByRole('dialog', { name: '新增分类' });
    await categoryDialog.getByLabel('名称').fill(categoryName);
    await categoryDialog.getByLabel('Slug（可选）').fill(categorySlug);
    await categoryDialog.getByLabel('排序').fill('11');
    await categoryDialog.getByRole('button', { name: '保存分类' }).click();
    await expect(page.getByText('分类已创建')).toBeVisible();
    await expect(page.getByRole('table', { name: '分类列表' }).getByText(categoryName)).toBeVisible();

    await page.getByRole('navigation', { name: '主管理导航' }).getByRole('link', { name: '滤镜' }).click();
    await page.getByRole('button', { name: '新增滤镜' }).first().click();

    const createDialog = page.getByRole('dialog', { name: '新增滤镜' });
    await createDialog.getByLabel('NCP 文件').setInputFiles(fixture02Path);
    await expect(createDialog.getByRole('region', { name: 'NCP 详情' })).toBeVisible();
    await expect(createDialog.getByRole('status')).toContainText('当前版本支持此 NCP');
    await expect(createDialog.getByLabel('显示名称')).toHaveValue('Fuji Astia');
    await createDialog.getByLabel('显示名称').fill(filterName);
    await createDialog.getByLabel('分类').selectOption({ label: categoryName });
    await createDialog.getByRole('button', { name: '保存滤镜' }).click();
    await expect(page.getByText('滤镜已创建')).toBeVisible();

    const createdRow = page.getByRole('table', { name: '滤镜列表' }).getByRole('row').filter({ hasText: filterName });
    await expect(createdRow).toContainText(categoryName);
    await createdRow.getByRole('button', { name: `编辑${filterName}` }).click();

    const editDialog = page.getByRole('dialog', { name: '编辑滤镜' });
    await editDialog.getByLabel('显示名称').fill(editedFilterName);
    await editDialog.getByLabel('排序').fill('37');
    await editDialog.getByLabel('启用滤镜').uncheck();
    await editDialog.getByRole('button', { name: '保存滤镜' }).click();
    await expect(page.getByText('滤镜已更新')).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(/\/admin\/filters$/);
    const persistedRow = page.getByRole('table', { name: '滤镜列表' }).getByRole('row').filter({ hasText: editedFilterName });
    await expect(persistedRow).toContainText(categoryName);
    await expect(persistedRow).toContainText('已停用');
    await expect(persistedRow).toContainText('37');

    await page.getByRole('navigation', { name: '主管理导航' }).getByRole('link', { name: '分类' }).click();
    const categoryRow = page.getByRole('table', { name: '分类列表' }).getByRole('row').filter({ hasText: categoryName });
    await categoryRow.getByRole('button', { name: `删除${categoryName}` }).click();
    const blockedDeleteDialog = page.getByRole('dialog', { name: '删除分类' });
    await blockedDeleteDialog.getByRole('button', { name: '删除分类' }).click();
    await expect(blockedDeleteDialog.getByRole('alert')).toContainText('请先移动或删除该分类下的滤镜');
    await blockedDeleteDialog.getByRole('button', { name: '取消' }).click();

    await page.getByRole('navigation', { name: '主管理导航' }).getByRole('link', { name: '滤镜' }).click();
    const filterRow = page.getByRole('table', { name: '滤镜列表' }).getByRole('row').filter({ hasText: editedFilterName });
    await filterRow.getByRole('button', { name: `删除${editedFilterName}` }).click();
    await page.getByRole('dialog', { name: '删除滤镜' }).getByRole('button', { name: '删除滤镜' }).click();
    await expect(page.getByText('滤镜已删除')).toBeVisible();
    await expect(page.getByRole('table', { name: '滤镜列表' })).toHaveCount(0);

    await page.getByRole('navigation', { name: '主管理导航' }).getByRole('link', { name: '分类' }).click();
    const cleanupCategoryRow = page.getByRole('table', { name: '分类列表' }).getByRole('row').filter({ hasText: categoryName });
    await cleanupCategoryRow.getByRole('button', { name: `删除${categoryName}` }).click();
    await page.getByRole('dialog', { name: '删除分类' }).getByRole('button', { name: '删除分类' }).click();
    await expect(page.getByText('分类已删除')).toBeVisible();
    await expect(page.getByRole('table', { name: '分类列表' })).toHaveCount(0);
  });

  test('bulk imports two genuine NCP filters sequentially into different categories', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The shared database lifecycle runs once on desktop.');

    const unique = `${Date.now()}-${process.pid}`;
    const firstCategoryName = `Bulk Film E2E ${unique}`;
    const secondCategoryName = `Bulk Mono E2E ${unique}`;
    const firstFilterName = `Bulk Astia E2E ${unique}`;
    const secondFilterName = `Bulk Tokugawa E2E ${unique}`;
    let activeFilterPosts = 0;
    let maximumActiveFilterPosts = 0;
    let filterPosts = 0;
    const observeSequentialPosts = async (route: Route) => {
      const request = route.request();
      if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/admin/filters') {
        await route.continue();
        return;
      }
      filterPosts += 1;
      activeFilterPosts += 1;
      maximumActiveFilterPosts = Math.max(maximumActiveFilterPosts, activeFilterPosts);
      try {
        const response = await route.fetch();
        await route.fulfill({ response });
      } finally {
        activeFilterPosts -= 1;
      }
    };

    await login(page);
    try {
      await page.getByRole('navigation', { name: '主管理导航' }).getByRole('link', { name: '分类' }).click();
      for (const [name, slug, sortOrder] of [
        [firstCategoryName, `bulk-film-e2e-${unique}`, '101'],
        [secondCategoryName, `bulk-mono-e2e-${unique}`, '102'],
      ] as const) {
        await page.getByRole('button', { name: '新增分类' }).first().click();
        const categoryDialog = page.getByRole('dialog', { name: '新增分类' });
        await categoryDialog.getByLabel('名称').fill(name);
        await categoryDialog.getByLabel('Slug（可选）').fill(slug);
        await categoryDialog.getByLabel('排序').fill(sortOrder);
        await categoryDialog.getByRole('button', { name: '保存分类' }).click();
        await expect(page.getByRole('table', { name: '分类列表' }).getByText(name, { exact: true })).toBeVisible();
      }

      await page.route('**/api/admin/filters', observeSequentialPosts);
      await page.getByRole('navigation', { name: '主管理导航' }).getByRole('link', { name: '滤镜' }).click();
      await page.getByRole('button', { name: '批量导入' }).click();

      const bulkDialog = page.getByRole('dialog', { name: '批量导入滤镜' });
      await bulkDialog.getByLabel('默认分类').selectOption({ label: firstCategoryName });
      await bulkDialog.getByLabel('NCP 文件（可多选）').setInputFiles([fixture02Path, fixture33Path]);
      const firstName = bulkDialog.getByLabel('PICCON02.NCP 显示名称（桌面）');
      const firstCategory = bulkDialog.getByLabel('PICCON02.NCP 分类（桌面）');
      const secondName = bulkDialog.getByLabel('PICCON33.NCP 显示名称（桌面）');
      const secondCategory = bulkDialog.getByLabel('PICCON33.NCP 分类（桌面）');
      await expect(firstName).toHaveValue('Fuji Astia');
      await expect(secondName).toHaveValue('SHING TokugawaTone2');
      await expect(firstCategory.locator('option:checked')).toHaveText(firstCategoryName);
      await firstName.fill(firstFilterName);
      await secondName.fill(secondFilterName);
      await secondCategory.selectOption({ label: secondCategoryName });
      await expect(secondCategory.locator('option:checked')).toHaveText(secondCategoryName);

      await bulkDialog.getByRole('button', { name: '导入可用项' }).click();

      await expect(bulkDialog.getByText('已导入 2 个滤镜，0 个需要处理')).toBeVisible();
      expect(filterPosts).toBe(2);
      expect(maximumActiveFilterPosts).toBe(1);
      await bulkDialog.getByRole('button', { name: '取消' }).click();
      await expect(bulkDialog).toHaveCount(0);

      const filterTable = page.getByRole('table', { name: '滤镜列表' });
      const firstRow = filterTable.getByRole('row').filter({ hasText: firstFilterName });
      const secondRow = filterTable.getByRole('row').filter({ hasText: secondFilterName });
      await expect(firstRow).toContainText(firstCategoryName);
      await expect(secondRow).toContainText(secondCategoryName);
    } finally {
      await page.unroute('**/api/admin/filters', observeSequentialPosts);
      await cleanupBulkImportRecords(
        page,
        [firstFilterName, secondFilterName],
        [firstCategoryName, secondCategoryName],
      );
    }
  });
});

test('desktop and mobile navigation retain the selected theme', async ({ page }, testInfo) => {
  await login(page);
  await useResponsiveNavigation(page, testInfo.project.name, '分类');
  await useResponsiveNavigation(page, testInfo.project.name, '滤镜');

  const initialTheme = await page.locator('html').getAttribute('data-theme');
  expect(initialTheme === 'dark' || initialTheme === 'light').toBe(true);
  const nextTheme = initialTheme === 'dark' ? 'light' : 'dark';
  await page.getByRole('button', { name: initialTheme === 'dark' ? '切换为浅色主题' : '切换为深色主题' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', nextTheme);

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', nextTheme);
  await expect(page.getByRole('heading', { name: '滤镜', exact: true })).toBeVisible();
});

test('filter heading actions use a wrapping, non-overflowing layout', async ({ page }) => {
  await login(page);

  const actions = page.locator('.page-heading__actions');
  await expect(actions).toBeVisible();
  const layout = await actions.evaluate((element) => {
    const styles = getComputedStyle(element);
    const buttons = Array.from(element.querySelectorAll('button')).map((button) => {
      const box = button.getBoundingClientRect();
      return { left: box.left, right: box.right };
    });
    return {
      display: styles.display,
      flexWrap: styles.flexWrap,
      columnGap: Number.parseFloat(styles.columnGap),
      rowGap: Number.parseFloat(styles.rowGap),
      buttons,
      viewportWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });

  expect(layout.display).toBe('flex');
  expect(layout.flexWrap).toBe('wrap');
  expect(layout.columnGap).toBeGreaterThan(0);
  expect(layout.rowGap).toBeGreaterThan(0);
  expect(layout.buttons.length).toBe(2);
  for (const button of layout.buttons) {
    expect(button.left).toBeGreaterThanOrEqual(0);
    expect(button.right).toBeLessThanOrEqual(layout.viewportWidth);
  }
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
});
